//! Runs a Terraform worker. Infrastructure credentials belong to this process.

use std::{env, path::PathBuf, time::Duration};
use tokio::sync::watch;

/// Runs an infrastructure worker configured by environment variables.
pub async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let server =
        env::var("CODER_PROVISIONER_URL").unwrap_or_else(|_| "http://127.0.0.1:3000".into());
    let token =
        env::var("CODER_PROVISIONER_TOKEN").map_err(|_| "CODER_PROVISIONER_TOKEN is required")?;
    let recovery = env::var_os("CODER_PROVISIONER_RECOVERY_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| "coder-provisioner-recovery".into());
    let engine = crate::engine::Engine::from_environment()?;
    let mut worker = crate::Worker::with_engine(&server, token, engine, recovery)?;
    if let Some(mirror) = env::var_os("CODER_PROVIDER_MIRROR") {
        worker = worker.with_provider_mirror(mirror.into())?;
    }
    let (stop, stopped) = watch::channel(false);
    let signal = tokio::spawn(async move {
        #[cfg(unix)]
        {
            let mut term =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    .expect("install SIGTERM handler");
            tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = term.recv() => {} }
        }
        #[cfg(not(unix))]
        let _ = tokio::signal::ctrl_c().await;
        let _ = stop.send(true);
    });
    while !*stopped.borrow() {
        match worker.run_once(stopped.clone()).await {
            Ok(true) => continue,
            Ok(false) => {}
            Err(error) => eprintln!("Provisioner: {error}"),
        }
        let mut change = stopped.clone();
        tokio::select! { _ = tokio::time::sleep(Duration::from_secs(3)) => {}, _ = change.changed() => {} }
    }
    signal.abort();
    Ok(())
}
