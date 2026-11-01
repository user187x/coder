//! Runs the Rust control plane and Rust-rendered UI against external PostgreSQL.

use crate::config::{HELP, ServerConfig};
use std::net::SocketAddr;

/// Runs the standalone server with explicit flags and environment defaults.
pub async fn run() -> Result<(), Box<dyn std::error::Error>> {
    run_command("server", std::env::args().skip(1)).await
}

/// Runs server, migrate, or db-check with the same PostgreSQL parameter parser.
pub async fn run_command(
    command: &str,
    args: impl IntoIterator<Item = String>,
) -> Result<(), Box<dyn std::error::Error>> {
    if !matches!(command, "server" | "migrate" | "db-check") {
        return Err("Unknown server command".into());
    }
    let args = args.into_iter().collect::<Vec<_>>();
    if args.iter().any(|a| matches!(a.as_str(), "--help" | "-h")) {
        print!("{HELP}");
        return Ok(());
    }
    let config = ServerConfig::from_args(args)?;
    let pool = config.connect().await?;
    if command == "db-check" {
        sqlx::query("SELECT 1")
            .execute(&pool)
            .await
            .map_err(|_| "PostgreSQL connectivity check failed")?;
        pool.close().await;
        println!("PostgreSQL connection succeeded; no migrations applied.");
        return Ok(());
    }
    if command == "migrate" || config.migrate {
        crate::migrate(&pool).await.map_err(
            |_| "PostgreSQL migration failed. Check schema privileges and migration compatibility.",
        )?;
    } else {
        crate::verify_schema(&pool).await?;
    }
    if command == "migrate" {
        pool.close().await;
        println!("PostgreSQL schema migrations applied successfully.");
        return Ok(());
    }
    if let Some(oidc) = &config.oidc {
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM coder_rust.organizations WHERE id=$1)")
                .bind(oidc.organization)
                .fetch_one(&pool)
                .await
                .map_err(|_| "OIDC organization check failed")?;
        if !exists {
            return Err(
                "Complete initial setup before configuring OIDC with an existing organization ID"
                    .into(),
            );
        }
    }
    // Bind first so an ephemeral port is passed correctly to the internal UI API client.
    let listener = tokio::net::TcpListener::bind(config.listen)
        .await
        .map_err(|_| "HTTP listener could not be bound")?;
    let bound = listener.local_addr()?;
    let mut internal: SocketAddr = bound;
    if internal.ip().is_unspecified() {
        internal.set_ip(if internal.is_ipv4() {
            std::net::Ipv4Addr::LOCALHOST.into()
        } else {
            std::net::Ipv6Addr::LOCALHOST.into()
        });
    }
    let origin = config
        .origin
        .unwrap_or_else(|| format!("http://{internal}"));
    let app =
        crate::api_with_options(pool.clone(), config.encryption_key, &origin, config.oidc)?.merge(
            coder_ui::integrated_router(&format!("http://{internal}"), &origin)?,
        );
    eprintln!("Coder Rust control plane: {origin} (first-time setup: {origin}/setup)");
    let schedule_pool = pool.clone();
    let scheduler = tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            if crate::schedules::reconcile(&schedule_pool).await.is_err() {
                eprintln!("Workspace scheduler pass failed; retrying on the next interval.");
            }
        }
    });
    let result = axum::serve(listener, app)
        .with_graceful_shutdown(async {
            #[cfg(unix)]
            {
                let mut term =
                    tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                        .expect("SIGTERM handler");
                tokio::select! {_=tokio::signal::ctrl_c()=>{},_=term.recv()=>{}}
            }
            #[cfg(not(unix))]
            let _ = tokio::signal::ctrl_c().await;
        })
        .await;
    scheduler.abort();
    let _ = scheduler.await;
    pool.close().await;
    result?;
    Ok(())
}
