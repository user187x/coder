//! Runs the Rust control plane and Rust-rendered UI in one process.

use std::{env, net::SocketAddr};

/// Runs the Rust API and dashboard configured by environment variables.
pub async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let database = env::var("DATABASE_URL").map_err(|_| "DATABASE_URL must point to PostgreSQL")?;
    let listen: SocketAddr = env::var("CODER_SERVER_LISTEN")
        .unwrap_or_else(|_| "127.0.0.1:3000".into())
        .parse()?;
    let origin = env::var("CODER_SERVER_ORIGIN").unwrap_or_else(|_| format!("http://{listen}"));
    let secret_key = env::var("CODER_ENCRYPTION_KEY")
        .ok()
        .map(|v| crate::encryption_key(&v))
        .transpose()?;
    let pool = crate::connect(&database).await?;
    let mut internal = listen;
    if internal.ip().is_unspecified() {
        internal.set_ip(if internal.is_ipv4() {
            std::net::Ipv4Addr::LOCALHOST.into()
        } else {
            std::net::Ipv6Addr::LOCALHOST.into()
        });
    }
    let app = crate::api(pool, secret_key).merge(coder_ui::integrated_router(
        &format!("http://{internal}"),
        &origin,
    )?);
    let listener = tokio::net::TcpListener::bind(listen).await?;
    eprintln!("Coder Rust control plane: {origin} (first-time setup: {origin}/setup)");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            #[cfg(unix)]
            {
                let mut term =
                    tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                        .expect("SIGTERM handler");
                tokio::select! { _=tokio::signal::ctrl_c()=>{}, _=term.recv()=>{} }
            }
            #[cfg(not(unix))]
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
