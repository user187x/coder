//! Runs the Rust Coder dashboard against an existing Coder API.

use std::{env, net::SocketAddr};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let listen: SocketAddr = env::var("CODER_UI_LISTEN")
        .unwrap_or_else(|_| "127.0.0.1:8080".into())
        .parse()?;
    let backend = env::var("CODER_UI_BACKEND").unwrap_or_else(|_| "http://127.0.0.1:3000".into());
    let origin = env::var("CODER_UI_ORIGIN").unwrap_or_else(|_| format!("http://{listen}"));
    let app = coder_ui::router(&backend, &origin)?;
    let listener = tokio::net::TcpListener::bind(listen).await?;
    eprintln!("Coder UI listening on {origin}");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
