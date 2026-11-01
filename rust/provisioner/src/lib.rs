//! Terraform execution with renewable job leases and encrypted remote state.

mod api;
pub mod engine;
mod runner;
mod terraform;
pub use runner::run;

use api::{Api, Job, Snapshot};
use serde_json::{Value, json};
use std::{fmt, path::PathBuf, time::Duration};
use tokio::sync::watch;

/// A failure without credential values or raw Terraform diagnostics.
#[derive(Debug)]
pub enum Error {
    /// Invalid worker configuration.
    Config(&'static str),
    /// An HTTP request could not be completed.
    Network,
    /// The control plane rejected a request with this HTTP status.
    Api(u16),
    /// A malformed response or state was received.
    Protocol(&'static str),
    /// Local filesystem or process operation failed.
    Io(std::io::Error),
    /// A Terraform phase failed.
    Terraform(&'static str),
    /// Execution was canceled, timed out, or lost its lease.
    Canceled,
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Config(s) | Self::Protocol(s) | Self::Terraform(s) => f.write_str(s),
            Self::Network => f.write_str("Control-plane request could not be completed."),
            Self::Api(code) => write!(f, "Control plane returned HTTP {code}."),
            Self::Io(_) => f.write_str("A local filesystem or process operation failed."),
            Self::Canceled => {
                f.write_str("Terraform execution canceled, timed out, or lost its lease.")
            }
        }
    }
}
impl std::error::Error for Error {}
impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

/// A single-job-at-a-time Terraform provisioner. Multiple instances can share an organization queue.
pub struct Worker {
    api: Api,
    binary: PathBuf,
    _engine: Option<engine::Engine>,
    mirror: Option<PathBuf>,
    recovery: PathBuf,
    timeout: Duration,
}
impl Worker {
    /// Creates a worker using an existing Terraform executable and private recovery directory.
    pub fn new(
        server: &str,
        token: String,
        binary: PathBuf,
        recovery: PathBuf,
    ) -> Result<Self, Error> {
        #[cfg(not(unix))]
        {
            return Err(Error::Config(
                "The Terraform worker currently requires Unix process groups.",
            ));
        }
        let binary = if binary.components().count() > 1 {
            std::fs::canonicalize(binary)?
        } else {
            binary
        };
        terraform::private_directory(&recovery)?;
        Ok(Self {
            api: Api::new(server, token)?,
            binary,
            _engine: None,
            mirror: None,
            recovery,
            timeout: Duration::from_secs(1800),
        })
    }
    /// Constructs a worker from a replaceable or bundled engine.
    pub fn with_engine(
        server: &str,
        token: String,
        engine: engine::Engine,
        recovery: PathBuf,
    ) -> Result<Self, Error> {
        let mut worker = Self::new(server, token, engine.path().to_owned(), recovery)?;
        worker._engine = Some(engine);
        Ok(worker)
    }
    /// Restricts provider installation to a local filesystem mirror, without registry fallback.
    pub fn with_provider_mirror(mut self, mirror: PathBuf) -> Result<Self, Error> {
        let mirror = std::fs::canonicalize(mirror)?;
        if !mirror.is_dir() {
            return Err(Error::Config("Provider mirror must be a directory."));
        }
        self.mirror = Some(mirror);
        Ok(self)
    }
    /// Sets the deadline for all Terraform phases in one job.
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// Claims and executes one Terraform job; returns false if the queue is empty.
    /// The shutdown receiver must remain open for the duration of the call.
    pub async fn run_once(&self, mut shutdown: watch::Receiver<bool>) -> Result<bool, Error> {
        if *shutdown.borrow() {
            return Ok(false);
        }
        let job: Option<Job> = self.api.post("claim", json!({})).await?;
        let Some(job) = job else { return Ok(false) };
        let mut snapshot: Snapshot = self
            .api
            .post(
                &format!("{}/state/read", job.id),
                json!({"lease_token":job.lease_token}),
            )
            .await?;
        if snapshot.dirty {
            return Err(Error::Protocol("State requires operator recovery."));
        }
        let (cancel, canceled) = watch::channel(false);
        let (finished, mut done) = watch::channel(false);
        let api = self.api.clone();
        let id = job.id;
        let lease = job.lease_token.clone();
        let heartbeat = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            loop {
                tokio::select! {
                    _=done.changed()=>break,
                    result=shutdown.changed()=>{if result.is_err() || *shutdown.borrow(){let _=cancel.send(true);break;}},
                    _=interval.tick()=>{if api.post::<Value>(&format!("{id}/heartbeat"),json!({"lease_token":lease})).await.is_err(){let _=cancel.send(true);break;}},
                }
            }
        });
        let result = self.execute(&job, &mut snapshot, canceled).await;
        let (success, resources, error) = match &result {
            Ok(resources) => (true, resources.clone(), String::new()),
            Err(error) => (false, Vec::new(), error.to_string()),
        };
        let completed=self.api.post::<Value>(&format!("{}/complete",job.id),json!({"lease_token":job.lease_token,"success":success,"resources":resources,"error":error,"state_revision":snapshot.revision})).await;
        let _ = finished.send(true);
        heartbeat.abort();
        let _ = heartbeat.await;
        completed?;
        if let Err(error) = result {
            eprintln!("Build {} failed: {error}", job.id);
        }
        Ok(true)
    }
}
