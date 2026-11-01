//! One distributable executable for the implemented Rust application roles.

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    match std::env::args().nth(1).as_deref() {
        None | Some("server") => coder_server::run().await,
        Some("worker") => coder_provisioner::run().await,
        Some("agent" | "connect" | "forward" | "register") => coder_network::run().await,
        Some("engine-license") => {
            println!(
                "{}",
                coder_provisioner::engine::ENGINE_LICENSE
                    .unwrap_or("This build has no embedded engine.")
            );
            Ok(())
        }
        Some("engine") => {
            let engine = coder_provisioner::engine::Engine::from_environment()?;
            let status = tokio::process::Command::new(engine.path())
                .args(std::env::args_os().skip(2))
                .status()
                .await?;
            if !status.success() {
                return Err("Infrastructure engine command failed".into());
            }
            Ok(())
        }
        _ => Err(
            "Usage: coder [server|worker|agent|register|connect|forward|engine|engine-license]"
                .into(),
        ),
    }
}
