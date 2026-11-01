//! PostgreSQL configuration, explicit migrations, schema validation, and DB readiness.

use axum::{body::Body, http::Request};
use coder_server::{config::ServerConfig, run_command};
use reqwest::StatusCode;
use tower::ServiceExt;

fn args(url: &str) -> Vec<String> {
    vec![
        "--database-url".into(),
        url.into(),
        "--db-max-connections".into(),
        "1".into(),
    ]
}

#[tokio::test]
#[ignore = "requires a dedicated PostgreSQL database in CODER_TEST_DATABASE_URL"]
async fn external_postgres_configuration_migrations_and_readiness() {
    let mut url =
        std::env::var("CODER_TEST_DATABASE_URL").expect("Dedicated test database required");
    if std::env::var_os("CODER_TEST_SINGLE_CONNECTION").is_some() {
        url.push_str(if url.contains('?') {
            "&statement-cache-capacity=0"
        } else {
            "?statement-cache-capacity=0"
        });
    }
    let single = std::env::var_os("CODER_TEST_SINGLE_CONNECTION").is_some();
    if !single {
        run_command("db-check", args(&url)).await.unwrap();
        run_command("migrate", args(&url)).await.unwrap();
    }
    let config = ServerConfig::from_args(args(&url)).unwrap();
    let pool = config.connect().await.unwrap();
    if single {
        coder_server::migrate(&pool).await.unwrap();
    }
    coder_server::verify_schema(&pool).await.unwrap();
    let current: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!current.is_empty());
    let (version, checksum): (i64, Vec<u8>) = sqlx::query_as(
        "SELECT version,checksum FROM coder_rust._sqlx_migrations ORDER BY version LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE coder_rust._sqlx_migrations SET checksum=$1 WHERE version=$2")
        .bind(vec![0_u8; 48])
        .bind(version)
        .execute(&pool)
        .await
        .unwrap();
    assert!(coder_server::verify_schema(&pool).await.is_err());
    sqlx::query("UPDATE coder_rust._sqlx_migrations SET checksum=$1 WHERE version=$2")
        .bind(checksum)
        .bind(version)
        .execute(&pool)
        .await
        .unwrap();
    coder_server::verify_schema(&pool).await.unwrap();
    let router = coder_server::api(pool.clone(), Some([17; 32]));
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/readyz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    pool.close().await;
    let response = router
        .oneshot(
            Request::builder()
                .uri("/readyz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
#[ignore = "requires a TLS-enabled PostgreSQL endpoint and CODER_TEST_POSTGRES_TLS_CA"]
async fn postgres_tls_verifies_the_certificate_and_hostname() {
    let url = std::env::var("CODER_TEST_POSTGRES_TLS_URL").expect("TLS PostgreSQL URL");
    let ca = std::env::var("CODER_TEST_POSTGRES_TLS_CA").expect("PostgreSQL CA PEM");
    let mut flags = args(&url);
    flags.extend([
        "--db-ssl-mode".into(),
        "verify-full".into(),
        "--db-ssl-root-cert".into(),
        ca,
    ]);
    if let (Ok(cert), Ok(key)) = (
        std::env::var("CODER_TEST_POSTGRES_CLIENT_CERT"),
        std::env::var("CODER_TEST_POSTGRES_CLIENT_KEY"),
    ) {
        flags.extend(["--db-ssl-cert".into(), cert, "--db-ssl-key".into(), key]);
    }
    let pool = ServerConfig::from_args(flags.clone())
        .unwrap()
        .connect()
        .await
        .unwrap();
    let n: i32 = sqlx::query_scalar("SELECT 1::int4")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 1);
    pool.close().await;
    flags.extend([
        "--db-host".into(),
        "127.0.0.1".into(),
        "--db-connect-timeout".into(),
        "2".into(),
    ]);
    assert!(
        ServerConfig::from_args(flags)
            .unwrap()
            .connect()
            .await
            .is_err(),
        "a wrong certificate hostname or endpoint was accepted"
    );
}
