//! PostgreSQL-backed Rust control plane with durable, organization-scoped jobs.

mod auth;
mod catalog;
mod jobs;
mod network;
mod runner;
mod secrets;
mod state;
mod workspaces;
pub use runner::run;

use axum::{
    Json, Router,
    extract::DefaultBodyLimit,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::json;
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::{sync::Arc, time::Duration};
use tokio::sync::Semaphore;
use uuid::Uuid;

#[derive(Clone)]
pub(crate) struct App {
    pool: PgPool,
    broker: Arc<network::Broker>,
    hashes: Arc<Semaphore>,
    secret_key: Option<[u8; 32]>,
}

/// Connects to PostgreSQL and applies migrations in the isolated `coder_rust` schema.
pub async fn connect(url: &str) -> std::result::Result<PgPool, Box<dyn std::error::Error>> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(10))
        .connect(url)
        .await?;
    migrate(&pool).await?;
    Ok(pool)
}

/// Applies control-plane migrations using a caller-managed PostgreSQL pool.
pub async fn migrate(pool: &PgPool) -> std::result::Result<(), Box<dyn std::error::Error>> {
    sqlx::query("CREATE SCHEMA IF NOT EXISTS coder_rust")
        .execute(pool)
        .await?;
    let mut conn = pool.acquire().await?;
    sqlx::query("SET search_path TO coder_rust")
        .execute(&mut *conn)
        .await?;
    sqlx::migrate!("./migrations").run(&mut *conn).await?;
    drop(conn);
    Ok(())
}

/// Parses a 256-bit encryption key encoded as 64 hexadecimal characters.
pub fn encryption_key(value: &str) -> std::result::Result<[u8; 32], &'static str> {
    if value.len() != 64 || !value.is_ascii() {
        return Err("CODER_ENCRYPTION_KEY must contain 64 hexadecimal characters");
    }
    let mut key = [0; 32];
    for (i, item) in key.iter_mut().enumerate() {
        *item = u8::from_str_radix(&value[i * 2..i * 2 + 2], 16)
            .map_err(|_| "CODER_ENCRYPTION_KEY must be hexadecimal")?;
    }
    Ok(key)
}

/// Builds the JSON API. Authentication uses session headers, not browser cookies.
pub fn api(pool: PgPool, secret_key: Option<[u8; 32]>) -> Router {
    let app = App {
        broker: Arc::new(network::Broker::default()),
        pool,
        secret_key,
        hashes: Arc::new(Semaphore::new(4)),
    };
    Router::new()
        .route(
            "/api/v2/workspaces/{id}/agent",
            get(network::inspect)
                .post(network::register)
                .delete(network::revoke),
        )
        .route("/api/v2/workspaces/{id}/connect", get(network::connect))
        .route("/api/v2/workspaceagents/me/listen", get(network::listen))
        .route(
            "/api/v2/workspaceagents/me/connections/{id}",
            get(network::attach),
        )
        .route("/healthz", get(|| async { "ok" }))
        .route("/api/v2/users/first", get(auth::first).post(auth::setup))
        .route(
            "/api/v2/users/authmethods",
            get(|| async { Json(json!({"password":{"enabled":true}})) }),
        )
        .route("/api/v2/users/login", post(auth::login))
        .route("/api/v2/users/logout", post(auth::logout))
        .route("/api/v2/users", get(auth::users).post(auth::create_user))
        .route("/api/v2/users/{user}", get(auth::user))
        .route(
            "/api/v2/users/{user}/profile",
            axum::routing::put(auth::profile),
        )
        .route(
            "/api/v2/users/{user}/organizations",
            get(catalog::organizations),
        )
        .route("/api/v2/users/{user}/workspaces", post(workspaces::create))
        .route(
            "/api/v2/users/{user}/secrets",
            get(secrets::list).post(secrets::create),
        )
        .route(
            "/api/v2/users/{user}/secrets/{name}",
            axum::routing::delete(secrets::delete),
        )
        .route(
            "/api/v2/deployment/user-secrets/capabilities",
            get(secrets::capabilities),
        )
        .route("/api/v2/templates", get(catalog::templates))
        .route("/api/v2/templates/{id}", get(catalog::template))
        .route(
            "/api/v2/templateversions/{id}/rich-parameters",
            get(catalog::parameters),
        )
        .route(
            "/api/v2/organizations/{id}/templates",
            post(catalog::create_template),
        )
        .route(
            "/api/v2/organizations/{id}/provisionerkeys",
            post(jobs::create_key),
        )
        .route(
            "/api/v2/organizations/{org}/provisionerkeys/{id}",
            axum::routing::delete(jobs::delete_key),
        )
        .route("/api/v2/workspaces", get(workspaces::list))
        .route("/api/v2/workspaces/{id}", get(workspaces::get))
        .route(
            "/api/v2/workspaces/{id}/builds",
            get(workspaces::builds).post(workspaces::build),
        )
        .route(
            "/api/v2/workspaces/{id}/favorite",
            axum::routing::put(workspaces::favorite).delete(workspaces::unfavorite),
        )
        .route("/api/v2/workspacebuilds/{id}/logs", get(workspaces::logs))
        .route(
            "/api/v2/workspacebuilds/{id}/cancel",
            axum::routing::patch(workspaces::cancel),
        )
        .route(
            "/api/v2/workspaces/{id}/provisioner-state",
            get(state::inspect),
        )
        .route(
            "/api/v2/workspaces/{id}/provisioner-state/recover",
            post(state::recover).layer(DefaultBodyLimit::max(5 * 1024 * 1024)),
        )
        .route(
            "/api/v2/provisioner/jobs/{id}/state/read",
            post(state::read),
        )
        .route(
            "/api/v2/provisioner/jobs/{id}/state",
            post(state::write).layer(DefaultBodyLimit::max(5 * 1024 * 1024)),
        )
        .route("/api/v2/provisioner/jobs/claim", post(jobs::claim))
        .route(
            "/api/v2/provisioner/jobs/{id}/heartbeat",
            post(jobs::heartbeat),
        )
        .route("/api/v2/provisioner/jobs/{id}/logs", post(jobs::logs))
        .route(
            "/api/v2/provisioner/jobs/{id}/complete",
            post(jobs::complete),
        )
        .layer(DefaultBodyLimit::max(128 * 1024))
        .layer(axum::middleware::from_fn(
            |request: axum::extract::Request, next: axum::middleware::Next| async move {
                let mut response = next.run(request).await;
                response.headers_mut().insert(
                    axum::http::header::CACHE_CONTROL,
                    axum::http::HeaderValue::from_static("no-store"),
                );
                response
            },
        ))
        .with_state(app)
}

pub(crate) type Result<T = Json<serde_json::Value>> = std::result::Result<T, Error>;

#[derive(Debug)]
pub(crate) struct Error(StatusCode, String);
impl Error {
    fn bad(message: impl Into<String>) -> Self {
        Self(StatusCode::BAD_REQUEST, message.into())
    }
    fn forbidden() -> Self {
        Self(
            StatusCode::FORBIDDEN,
            "You do not have access to this resource.".into(),
        )
    }
    fn conflict(message: impl Into<String>) -> Self {
        Self(StatusCode::CONFLICT, message.into())
    }
}
impl From<sqlx::Error> for Error {
    fn from(error: sqlx::Error) -> Self {
        match error {
            sqlx::Error::RowNotFound => Self(StatusCode::NOT_FOUND, "Resource not found.".into()),
            sqlx::Error::Database(ref e) if e.is_unique_violation() => {
                Self::conflict("This name or email is already in use.")
            }
            _ => Self(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Database operation could not be completed.".into(),
            ),
        }
    }
}
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"message":self.1}))).into_response()
    }
}

pub(crate) fn name(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 32
        || matches!(value, "new" | "create")
        || !value
            .split('-')
            .all(|s| !s.is_empty() && s.bytes().all(|c| c.is_ascii_alphanumeric()))
    {
        return Err(Error::bad(
            "Name must be 1-32 alphanumeric characters separated by single hyphens; new and create are reserved.",
        ));
    }
    Ok(())
}

pub(crate) fn target(actor: &auth::User, user: &str) -> Result<Uuid> {
    if user == "me" || user == actor.id.to_string() {
        return Ok(actor.id);
    }
    if !actor.is_admin {
        return Err(Error::forbidden());
    }
    Uuid::parse_str(user).map_err(|_| Error::bad("Invalid user ID."))
}

pub(crate) async fn member(app: &App, user: Uuid, organization: Uuid) -> Result<()> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM coder_rust.memberships WHERE user_id=$1 AND organization_id=$2)")
        .bind(user).bind(organization).fetch_one(&app.pool).await?;
    if !exists {
        return Err(Error::forbidden());
    }
    Ok(())
}

pub(crate) fn header<'a>(headers: &'a HeaderMap, name: &str) -> Result<&'a str> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .filter(|s| !s.is_empty() && s.len() <= 1024)
        .ok_or_else(|| {
            Error(
                StatusCode::UNAUTHORIZED,
                "A valid authentication token is required.".into(),
            )
        })
}
