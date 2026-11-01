use crate::{
    Error, Worker,
    api::{Job, Snapshot},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    process::Stdio,
    time::Duration,
};
use tokio::{process::Command, sync::watch, time::Instant};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AgentSpec {
    ports: std::collections::BTreeSet<u16>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Spec {
    agent: Option<AgentSpec>,
    driver: String,
    files: BTreeMap<String, String>,
    #[serde(default)]
    variables: BTreeMap<String, Value>,
}

pub(crate) fn private_directory(path: &Path) -> Result<(), Error> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true).mode(0o700);
        builder.create(path)?;
        if fs::symlink_metadata(path)?.file_type().is_symlink()
            || fs::metadata(path)?.permissions().mode() & 0o777 != 0o700
        {
            return Err(Error::Config(
                "Recovery directory must be a private directory with mode 0700.",
            ));
        }
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        return Err(Error::Config("Unix worker required."));
    }
    Ok(())
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<(), Error> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

struct Directory {
    dir: Option<tempfile::TempDir>,
    preserve: bool,
}
impl Drop for Directory {
    fn drop(&mut self) {
        if self.preserve {
            if let Some(dir) = self.dir.take() {
                eprintln!(
                    "Infrastructure recovery files retained at {}",
                    dir.keep().display()
                );
            }
        }
    }
}

fn spec(job: &Job) -> Result<Spec, Error> {
    let spec: Spec = serde_json::from_value(job.provisioner_spec.clone())
        .map_err(|_| Error::Protocol("Invalid Terraform provisioner specification."))?;
    if spec.driver != "terraform"
        || spec.files.is_empty()
        || spec.files.len() > 32
        || spec.files.values().map(String::len).sum::<usize>() > 65536
    {
        return Err(Error::Protocol(
            "Terraform templates require 1-32 files totaling at most 64 KiB.",
        ));
    }
    if let Some(agent) = &spec.agent {
        if agent.ports.is_empty() || agent.ports.len() > 16 || agent.ports.contains(&0) {
            return Err(Error::Protocol("Allow 1-16 nonzero agent ports."));
        }
    }
    for name in spec.files.keys() {
        if name == ".terraform.lock.hcl" {
            continue;
        }
        if name.is_empty()
            || name.len() > 128
            || name.starts_with('.')
            || name.contains(['/', '\\'])
            || !(name.ends_with(".tf") || name.ends_with(".tf.json"))
            || !name.is_ascii()
        {
            return Err(Error::Protocol(
                "Terraform files must be flat .tf/.tf.json files or .terraform.lock.hcl.",
            ));
        }
    }
    if !matches!(job.transition.as_str(), "start" | "stop" | "delete") {
        return Err(Error::Protocol("Unsupported infrastructure transition."));
    }
    Ok(spec)
}

fn variables(job: &Job, spec: &Spec) -> Result<Value, Error> {
    let mut values = spec.variables.clone();
    if values.keys().any(|k| k.starts_with("coder_")) {
        return Err(Error::Protocol(
            "coder_ variables are reserved for the provisioner.",
        ));
    }
    for p in &job.parameters {
        if p.name.starts_with("coder_") {
            return Err(Error::Protocol(
                "coder_ parameters are reserved for the provisioner.",
            ));
        }
        let kind = job
            .parameter_schema
            .iter()
            .find(|s| s.name == p.name)
            .ok_or(Error::Protocol("Parameter is missing its schema."))?;
        let value = match kind.r#type.as_str() {
            "string" => Value::String(p.value.clone()),
            "number" => {
                let v: Value = serde_json::from_str(&p.value)
                    .map_err(|_| Error::Protocol("Invalid numeric parameter."))?;
                if !v.is_number() {
                    return Err(Error::Protocol("Invalid numeric parameter."));
                }
                v
            }
            "bool" => Value::Bool(
                p.value
                    .parse()
                    .map_err(|_| Error::Protocol("Invalid boolean parameter."))?,
            ),
            "list(string)" => json!(
                serde_json::from_str::<Vec<String>>(&p.value)
                    .map_err(|_| Error::Protocol("Invalid list parameter."))?
            ),
            _ => return Err(Error::Protocol("Unsupported parameter type.")),
        };
        values.insert(p.name.clone(), value);
    }
    Ok(json!(values))
}

fn state(path: &Path) -> Result<Value, Error> {
    let file = path.join("terraform.tfstate");
    match fs::symlink_metadata(&file) {
        Err(e) => Err(e.into()),
        Ok(meta) if !meta.file_type().is_file() || meta.len() > 4 * 1024 * 1024 => Err(
            Error::Protocol("Terraform state is not a regular file of at most 4 MiB."),
        ),
        Ok(_) => {
            let value: Value = serde_json::from_slice(&fs::read(file)?)
                .map_err(|_| Error::Protocol("Terraform wrote invalid state JSON."))?;
            if !value.is_object() || value["version"].as_u64().is_none() {
                return Err(Error::Protocol("Terraform wrote an invalid state object."));
            }
            Ok(value)
        }
    }
}

fn resources(state: &Value) -> Vec<Value> {
    let mut resources = Vec::new();
    if let Some(items) = state["resources"].as_array() {
        for item in items.iter().filter(|r| r["mode"] == "managed") {
            let Some(kind) = item["type"].as_str() else {
                continue;
            };
            let Some(name) = item["name"].as_str() else {
                continue;
            };
            if let Some(instances) = item["instances"].as_array() {
                for (index, _) in instances.iter().enumerate() {
                    if resources.len() == 100 {
                        return resources;
                    }
                    resources.push(json!({"name":format!("{kind}.{name}[{index}]"),"type":kind,"hide":false,"agents":[]}));
                }
            }
        }
    }
    resources
}

impl Worker {
    pub(crate) async fn execute(
        &self,
        job: &Job,
        snapshot: &mut Snapshot,
        cancel: watch::Receiver<bool>,
    ) -> Result<Vec<Value>, Error> {
        let spec = spec(job)?;
        let variables = variables(job, &spec)?;
        let mut builder = tempfile::Builder::new();
        let prefix = format!("work-{}-{}-", job.workspace_id, job.id);
        builder.prefix(&prefix);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            builder.permissions(std::fs::Permissions::from_mode(0o700));
        }
        let dir = builder.tempdir_in(&self.recovery)?;
        let mut directory = Directory {
            dir: Some(dir),
            preserve: false,
        };
        let path = directory
            .dir
            .as_ref()
            .expect("work directory")
            .path()
            .to_path_buf();
        for (name, contents) in &spec.files {
            write_private(&path.join(name), contents.as_bytes())?;
        }
        write_private(
            &path.join("coder.auto.tfvars.json"),
            &serde_json::to_vec(&variables)
                .map_err(|_| Error::Protocol("Invalid Terraform variables."))?,
        )?;
        // Use a job-local CLI config so user-global configuration cannot override the backend/mirror policy.
        let cli = if let Some(mirror) = &self.mirror {
            let path = mirror
                .to_str()
                .ok_or(Error::Config("Provider mirror path must be UTF-8."))?;
            let quoted = serde_json::to_string(&path.replace("${", "$${").replace("%{", "%%{"))
                .map_err(|_| Error::Config("Invalid mirror path."))?;
            format!("provider_installation {{ filesystem_mirror {{ path = {quoted} }} }}\n")
        } else {
            "provider_installation { direct {} }\n".into()
        };
        write_private(&path.join("coder.tfrc"), cli.as_bytes())?;
        let had_state = !snapshot.state.is_null();
        if had_state {
            write_private(
                &path.join("terraform.tfstate"),
                &serde_json::to_vec(&snapshot.state)
                    .map_err(|_| Error::Protocol("Invalid restored state."))?,
            )?;
        }
        let deadline = Instant::now() + self.timeout;
        self.api
            .log(job, "Terraform initialization started.")
            .await?;
        if command(
            &self.binary,
            &path,
            job,
            &["init", "-input=false", "-no-color", "-backend=false"],
            cancel.clone(),
            deadline,
        )
        .await?
            != 0
        {
            return Err(Error::Terraform("Terraform initialization failed."));
        }
        self.api.log(job, "Terraform planning started.").await?;
        let start_count = if job.transition == "start" {
            "-var=coder_start_count=1"
        } else {
            "-var=coder_start_count=0"
        };
        let mut args = vec![
            "plan",
            "-input=false",
            "-no-color",
            "-detailed-exitcode",
            "-out=coder.plan",
            start_count,
        ];
        if job.transition == "delete" {
            args.push("-destroy");
        }
        let code = command(&self.binary, &path, job, &args, cancel.clone(), deadline).await?;
        if code != 0 && code != 2 {
            return Err(Error::Terraform("Terraform planning failed."));
        }
        if *cancel.borrow() {
            return Err(Error::Canceled);
        }
        self.api
            .checkpoint(job, snapshot, snapshot.state.clone(), true)
            .await?;
        directory.preserve = true;
        self.api
            .log(
                job,
                "Terraform apply started; state recovery guard enabled.",
            )
            .await?;
        let applied = command(
            &self.binary,
            &path,
            job,
            &["apply", "-input=false", "-no-color", "coder.plan"],
            cancel,
            deadline,
        )
        .await;
        // Even a failed apply may have changed infrastructure and written useful state.
        let current = state(&path)?;
        self.api
            .checkpoint(job, snapshot, current.clone(), false)
            .await?;
        directory.preserve = false;
        if applied? != 0 {
            return Err(Error::Terraform(
                "Terraform apply failed; partial state was checkpointed.",
            ));
        }
        self.api
            .log(
                job,
                "Terraform apply completed; state checkpoint committed.",
            )
            .await?;
        Ok(resources(&current))
    }
}

#[cfg(unix)]
struct Group(Option<nix::unistd::Pid>);
#[cfg(unix)]
impl Group {
    fn signal(&self, signal: nix::sys::signal::Signal) {
        if let Some(pid) = self.0 {
            let _ = nix::sys::signal::killpg(pid, signal);
        }
    }
}
#[cfg(unix)]
impl Drop for Group {
    fn drop(&mut self) {
        self.signal(nix::sys::signal::Signal::SIGKILL);
    }
}

pub(crate) fn inherited(name: &str) -> bool {
    matches!(
        name,
        "PATH"
            | "HOME"
            | "USER"
            | "TMPDIR"
            | "TEMP"
            | "TMP"
            | "LANG"
            | "SSL_CERT_FILE"
            | "SSL_CERT_DIR"
            | "HTTP_PROXY"
            | "HTTPS_PROXY"
            | "NO_PROXY"
            | "http_proxy"
            | "https_proxy"
            | "no_proxy"
    ) || [
        "AWS_",
        "AZURE_",
        "ARM_",
        "GOOGLE_",
        "CLOUDSDK_",
        "TF_TOKEN_",
    ]
    .iter()
    .any(|prefix| name.starts_with(prefix))
}

#[cfg(unix)]
async fn command(
    binary: &Path,
    path: &Path,
    job: &Job,
    args: &[&str],
    mut canceled: watch::Receiver<bool>,
    deadline: Instant,
) -> Result<i32, Error> {
    if *canceled.borrow() {
        return Err(Error::Canceled);
    }
    let mut command = Command::new(binary);
    command
        .args(args)
        .current_dir(path)
        .env_clear()
        .envs(std::env::vars_os().filter(|(name, _)| name.to_str().is_some_and(inherited)))
        .env("TF_CLI_CONFIG_FILE", path.join("coder.tfrc"))
        .env("TF_IN_AUTOMATION", "1")
        .env("TF_INPUT", "0")
        .env("CHECKPOINT_DISABLE", "1")
        .env(
            "TF_VAR_coder_agent_token",
            job.agent["token"].as_str().unwrap_or(""),
        )
        .env("TF_VAR_coder_workspace_id", job.workspace_id.to_string())
        .env(
            "TF_VAR_coder_organization_id",
            job.organization_id.to_string(),
        )
        .env(
            "TF_VAR_coder_environment",
            serde_json::to_string(&job.environment)
                .map_err(|_| Error::Protocol("Invalid environment map."))?,
        )
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .process_group(0);
    let mut child = command.spawn()?;
    let group = Group(
        child
            .id()
            .and_then(|id| i32::try_from(id).ok())
            .map(nix::unistd::Pid::from_raw),
    );
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let out = tokio::spawn(async move {
        let mut reader = stdout;
        let _ = tokio::io::copy(&mut reader, &mut tokio::io::sink()).await;
    });
    let err = tokio::spawn(async move {
        let mut reader = stderr;
        let _ = tokio::io::copy(&mut reader, &mut tokio::io::sink()).await;
    });
    let status = tokio::select! {
        status=child.wait()=>Some(status?),
        _=canceled.changed()=>None,
        _=tokio::time::sleep_until(deadline)=>None,
    };
    if status.is_none() {
        group.signal(nix::sys::signal::Signal::SIGINT);
        if tokio::time::timeout(Duration::from_secs(10), child.wait())
            .await
            .is_err()
        {
            group.signal(nix::sys::signal::Signal::SIGKILL);
            let _ = child.wait().await;
        }
    }
    drop(group);
    let _ = tokio::time::timeout(Duration::from_secs(2), out).await;
    let _ = tokio::time::timeout(Duration::from_secs(2), err).await;
    status
        .map(|s| s.code().unwrap_or(-1))
        .ok_or(Error::Canceled)
}

#[cfg(not(unix))]
async fn command(
    _: &Path,
    _: &Path,
    _: &Job,
    _: &[&str],
    _: watch::Receiver<bool>,
    _: Instant,
) -> Result<i32, Error> {
    Err(Error::Config("Unix worker required."))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job() -> Job {
        serde_json::from_value(json!({
            "id":uuid::Uuid::new_v4(), "workspace_id":uuid::Uuid::new_v4(),
            "organization_id":uuid::Uuid::new_v4(), "transition":"start",
            "provisioner_spec":{"driver":"terraform","files":{"main.tf":""}},
            "parameters":[], "parameter_schema":[], "environment":{}, "lease_token":"private"
        }))
        .unwrap()
    }

    #[test]
    fn rejects_escaping_files_and_reserved_variables() {
        for name in [
            "../main.tf",
            "/main.tf",
            "nested/main.tf",
            "nested\\main.tf",
            ".hidden.tf",
            "terraform.tfstate",
            "coder.auto.tfvars.json",
        ] {
            let mut job = job();
            job.provisioner_spec["files"] = json!({name:""});
            assert!(spec(&job).is_err(), "accepted {name}");
        }
        let mut job = job();
        job.provisioner_spec["variables"] = json!({"coder_start_count":99});
        assert!(variables(&job, &spec(&job).unwrap()).is_err());
    }

    #[test]
    fn child_credentials_and_state_are_bounded() {
        for key in [
            "CODER_PROVISIONER_TOKEN",
            "CODER_ENCRYPTION_KEY",
            "TF_CLI_ARGS",
            "TF_VAR_password",
            "LD_PRELOAD",
        ] {
            assert!(!inherited(key));
        }
        for key in [
            "AWS_ACCESS_KEY_ID",
            "ARM_CLIENT_SECRET",
            "GOOGLE_APPLICATION_CREDENTIALS",
            "PATH",
        ] {
            assert!(inherited(key));
        }
        let directory = tempfile::tempdir().unwrap();
        assert!(state(directory.path()).is_err());
        fs::write(
            directory.path().join("terraform.tfstate"),
            b"{\"version\":4}",
        )
        .unwrap();
        assert_eq!(state(directory.path()).unwrap()["version"], 4);
        #[cfg(unix)]
        {
            fs::remove_file(directory.path().join("terraform.tfstate")).unwrap();
            std::os::unix::fs::symlink("/etc/passwd", directory.path().join("terraform.tfstate"))
                .unwrap();
            assert!(state(directory.path()).is_err());
        }
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn cancellation_interrupts_the_process_group() {
        let directory = tempfile::tempdir().unwrap();
        let (cancel, canceled) = watch::channel(false);
        let path = directory.path().to_owned();
        let run = tokio::spawn(async move {
            command(
                Path::new("/bin/sh"),
                &path,
                &job(),
                &[
                    "-c",
                    "trap 'exit 0' INT; sleep 60 & printf '%s' \"$!\" > child-pid; wait",
                ],
                canceled,
                Instant::now() + Duration::from_secs(15),
            )
            .await
        });
        tokio::time::timeout(Duration::from_secs(5), async {
            while !directory.path().join("child-pid").exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("child process started");
        cancel.send(true).unwrap();
        assert!(matches!(
            tokio::time::timeout(Duration::from_secs(12), run)
                .await
                .unwrap()
                .unwrap(),
            Err(Error::Canceled)
        ));
        let pid = fs::read_to_string(directory.path().join("child-pid")).unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let stat = fs::read_to_string(format!("/proc/{pid}/stat"));
                if stat
                    .as_ref()
                    .is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound)
                    || stat.as_ref().is_ok_and(|s| {
                        s.split(')')
                            .nth(1)
                            .is_some_and(|s| s.trim_start().starts_with('Z'))
                    })
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("descendant is no longer running");
    }
}
