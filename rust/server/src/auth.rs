use crate::{App, Error, Result};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use rand::{RngCore, rngs::OsRng};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(FromRow)]
pub(crate) struct User {
    pub id: Uuid,
    pub username: String,
    pub email: String,
    pub name: String,
    pub avatar_url: String,
    pub is_admin: bool,
    pub status: String,
    pub login_type: String,
}
impl User {
    pub fn json(&self) -> Value {
        json!({"id":self.id,"username":self.username,"email":self.email,"name":self.name,"avatar_url":self.avatar_url,
            "status":self.status,"roles":if self.is_admin {vec![json!({"name":"owner"})]} else {vec![]},"login_type":self.login_type})
    }
    pub fn admin(&self) -> Result<()> {
        if self.is_admin {
            Ok(())
        } else {
            Err(Error::forbidden())
        }
    }
}

pub(crate) fn digest(value: &str) -> String {
    hex(&Sha256::digest(value.as_bytes()))
}
pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
pub(crate) fn token() -> String {
    let mut bytes = [0; 32];
    OsRng.fill_bytes(&mut bytes);
    hex(&bytes)
}

pub(crate) async fn actor(app: &App, headers: &HeaderMap) -> Result<User> {
    let token = crate::header(headers, "Coder-Session-Token")?;
    sqlx::query_as::<_,User>("SELECT u.id,u.username,u.email,u.name,u.avatar_url,u.is_admin,u.status,u.login_type FROM coder_rust.users u JOIN coder_rust.sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.status='active'")
        .bind(digest(token)).fetch_optional(&app.pool).await?.ok_or_else(|| Error(StatusCode::UNAUTHORIZED,"Session expired or invalid.".into()))
}

async fn password(app: &App, raw: String, stored: Option<String>, verify: bool) -> Result<String> {
    let permit = app.hashes.clone().try_acquire_owned().map_err(|_| {
        Error(
            StatusCode::TOO_MANY_REQUESTS,
            "Authentication is busy. Try again shortly.".into(),
        )
    })?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let hash = Argon2::default()
            .hash_password(raw.as_bytes(), &SaltString::generate(&mut OsRng))
            .map_err(|_| {
                Error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Password hashing unavailable.".into(),
                )
            })?
            .to_string();
        if verify {
            let stored = stored.unwrap_or_else(|| hash.clone());
            let parsed = PasswordHash::new(&stored)
                .map_err(|_| Error(StatusCode::UNAUTHORIZED, "Invalid credentials.".into()))?;
            Argon2::default()
                .verify_password(raw.as_bytes(), &parsed)
                .map_err(|_| Error(StatusCode::UNAUTHORIZED, "Invalid credentials.".into()))?;
        }
        Ok(hash)
    })
    .await
    .map_err(|_| {
        Error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Authentication task interrupted.".into(),
        )
    })?
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CreateUser {
    pub email: String,
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub organization_ids: Vec<Uuid>,
}
fn validate(req: &CreateUser) -> Result<()> {
    crate::name(&req.username)?;
    if req.email.len() > 254
        || !req.email.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty() && !domain.is_empty() && !domain.contains('@')
        })
        || req.email.trim() != req.email
        || req.name.len() > 128
        || req.name.trim() != req.name
        || req.email.chars().any(char::is_whitespace)
        || req.password.len() < 12
        || req.password.len() > 1024
    {
        return Err(Error::bad(
            "Provide a valid email, a name up to 128 bytes, and a password of 12-1024 bytes.",
        ));
    }
    Ok(())
}

pub(crate) async fn first(State(app): State<App>) -> Result {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM coder_rust.users)")
        .fetch_one(&app.pool)
        .await?;
    if exists {
        Ok(Json(json!({"has_first_user":true})))
    } else {
        Err(Error(
            StatusCode::NOT_FOUND,
            "Initial setup is required.".into(),
        ))
    }
}

pub(crate) async fn setup(
    State(app): State<App>,
    Json(req): Json<CreateUser>,
) -> Result<(StatusCode, Json<Value>)> {
    let initialized: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM coder_rust.users)")
        .fetch_one(&app.pool)
        .await?;
    if initialized {
        return Err(Error::conflict("Initial setup has already been completed."));
    }
    validate(&req)?;
    let hash = password(&app, req.password, None, false).await?;
    let mut tx = app.pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(1870101)")
        .execute(&mut *tx)
        .await?;
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM coder_rust.users)")
        .fetch_one(&mut *tx)
        .await?;
    if exists {
        return Err(Error::conflict("Initial setup has already been completed."));
    }
    let id = Uuid::new_v4();
    let org = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO coder_rust.organizations(id,name,display_name) VALUES($1,'default','Default')",
    )
    .bind(org)
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO coder_rust.users(id,username,email,name,password_hash,is_admin) VALUES($1,$2,$3,$4,$5,true)")
        .bind(id).bind(req.username).bind(req.email).bind(req.name).bind(hash).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO coder_rust.memberships VALUES($1,$2)")
        .bind(org)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"user_id":id,"organization_id":org})),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Login {
    email: String,
    password: String,
}
pub(crate) async fn login(State(app): State<App>, Json(req): Json<Login>) -> Result {
    if !crate::oidc::password_enabled(&app) {
        return Err(Error::forbidden());
    }
    if req.email.len() > 254 || req.password.len() > 1024 {
        return Err(Error::bad("Credentials exceed the permitted length."));
    }
    let attempts:i32=sqlx::query_scalar("INSERT INTO coder_rust.login_limits(identity_hash,attempts) VALUES($1,1) ON CONFLICT(identity_hash) DO UPDATE SET attempts=CASE WHEN login_limits.window_start < now()-interval '1 minute' THEN 1 ELSE login_limits.attempts+1 END,window_start=CASE WHEN login_limits.window_start < now()-interval '1 minute' THEN now() ELSE login_limits.window_start END RETURNING attempts")
        .bind(digest(&req.email.to_lowercase())).fetch_one(&app.pool).await?;
    if attempts > 10 {
        return Err(Error(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many sign-in attempts. Try again in one minute.".into(),
        ));
    }
    let row:Option<(Uuid,String)>=sqlx::query_as("SELECT id,password_hash FROM coder_rust.users WHERE (lower(email)=lower($1) OR lower(username)=lower($1)) AND status='active' AND login_type='password'")
        .bind(&req.email).fetch_optional(&app.pool).await?;
    let stored = row.as_ref().map(|(_, hash)| hash.clone());
    password(&app, req.password, stored, true).await?;
    let (id, _) =
        row.ok_or_else(|| Error(StatusCode::UNAUTHORIZED, "Invalid credentials.".into()))?;
    let token = token();
    sqlx::query("DELETE FROM coder_rust.sessions WHERE expires_at<=now()")
        .execute(&app.pool)
        .await?;
    sqlx::query("INSERT INTO coder_rust.sessions VALUES($1,$2,now()+interval '1 day')")
        .bind(digest(&token))
        .bind(id)
        .execute(&app.pool)
        .await?;
    Ok(Json(json!({"session_token":token})))
}

pub(crate) async fn logout(State(app): State<App>, headers: HeaderMap) -> Result {
    actor(&app, &headers).await?;
    sqlx::query("DELETE FROM coder_rust.sessions WHERE token_hash=$1")
        .bind(digest(crate::header(&headers, "Coder-Session-Token")?))
        .execute(&app.pool)
        .await?;
    Ok(Json(json!({"message":"Signed out."})))
}

/// POST /api/v2/users/me/tokens: creates a one-day CLI session for a signed-in user.
pub(crate) async fn cli_token(State(app): State<App>, headers: HeaderMap) -> Result {
    let actor = actor(&app, &headers).await?;
    let token = token();
    sqlx::query("INSERT INTO coder_rust.sessions VALUES($1,$2,now()+interval '1 day')")
        .bind(digest(&token))
        .bind(actor.id)
        .execute(&app.pool)
        .await?;
    Ok(Json(json!({"session_token":token,"expires_in":86400})))
}

/// DELETE /api/v2/users/me/sessions: revokes all browser and CLI sessions.
pub(crate) async fn revoke_sessions(State(app): State<App>, headers: HeaderMap) -> Result {
    let actor = actor(&app, &headers).await?;
    sqlx::query("DELETE FROM coder_rust.sessions WHERE user_id=$1")
        .bind(actor.id)
        .execute(&app.pool)
        .await?;
    Ok(Json(json!({"message":"All sessions revoked."})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Status {
    status: String,
}
/// PATCH /api/v2/users/{id}/status: suspends a member and revokes all sessions.
pub(crate) async fn status(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<Status>,
) -> Result {
    let actor = actor(&app, &headers).await?;
    actor.admin()?;
    if !matches!(req.status.as_str(), "active" | "suspended") {
        return Err(Error::bad("Status must be active or suspended."));
    }
    let mut tx = app.pool.begin().await?;
    let updated = sqlx::query("UPDATE coder_rust.users SET status=$1 WHERE id=$2 AND NOT is_admin")
        .bind(&req.status)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    if updated.rows_affected() != 1 {
        return Err(Error::bad(
            "Member not found; deployment owners cannot be suspended.",
        ));
    }
    if req.status == "suspended" {
        sqlx::query("DELETE FROM coder_rust.sessions WHERE user_id=$1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    let orgs: Vec<Uuid> =
        sqlx::query_scalar("SELECT organization_id FROM coder_rust.memberships WHERE user_id=$1")
            .bind(id)
            .fetch_all(&mut *tx)
            .await?;
    for org in orgs {
        crate::rbac::audit(
            &mut tx,
            org,
            actor.id,
            &format!("user.{}", req.status),
            Some(id),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"message":"Member status updated."})))
}
pub(crate) async fn user(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result {
    let actor = actor(&app, &headers).await?;
    let id = crate::target(&actor, &id)?;
    let user=sqlx::query_as::<_,User>("SELECT id,username,email,name,avatar_url,is_admin,status,login_type FROM coder_rust.users WHERE id=$1").bind(id).fetch_one(&app.pool).await?;
    Ok(Json(user.json()))
}

#[derive(Deserialize, Default)]
pub(crate) struct Search {
    #[serde(default)]
    pub q: String,
    #[serde(default)]
    pub offset: i64,
    pub limit: Option<i64>,
}
impl Search {
    pub fn page(&self) -> Result<(i64, i64)> {
        if self.offset < 0 || self.offset > 1_000_000 || self.q.len() > 2048 {
            return Err(Error::bad("Invalid pagination or search."));
        }
        Ok((self.offset, self.limit.unwrap_or(25).clamp(1, 100)))
    }
}
pub(crate) async fn users(
    State(app): State<App>,
    headers: HeaderMap,
    Query(search): Query<Search>,
) -> Result {
    actor(&app, &headers).await?.admin()?;
    let (offset, limit) = search.page()?;
    let q = format!("%{}%", search.q);
    let users=sqlx::query_as::<_,User>("SELECT id,username,email,name,avatar_url,is_admin,status,login_type FROM coder_rust.users WHERE username ILIKE $1 OR email ILIKE $1 ORDER BY username LIMIT $2 OFFSET $3")
        .bind(&q).bind(limit).bind(offset).fetch_all(&app.pool).await?;
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM coder_rust.users WHERE username ILIKE $1 OR email ILIKE $1",
    )
    .bind(q)
    .fetch_one(&app.pool)
    .await?;
    Ok(Json(
        json!({"users":users.iter().map(User::json).collect::<Vec<_>>(),"count":count}),
    ))
}
pub(crate) async fn create_user(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<CreateUser>,
) -> Result<(StatusCode, Json<Value>)> {
    let actor = actor(&app, &headers).await?;
    actor.admin()?;
    validate(&req)?;
    if req.organization_ids.is_empty() {
        return Err(Error::bad("At least one organization is required."));
    }
    for org in &req.organization_ids {
        crate::member(&app, actor.id, *org).await?;
    }
    let hash = password(&app, req.password, None, false).await?;
    let id = Uuid::new_v4();
    let mut tx = app.pool.begin().await?;
    sqlx::query(
        "INSERT INTO coder_rust.users(id,username,email,name,password_hash) VALUES($1,$2,$3,$4,$5)",
    )
    .bind(id)
    .bind(&req.username)
    .bind(&req.email)
    .bind(&req.name)
    .bind(hash)
    .execute(&mut *tx)
    .await?;
    for org in req.organization_ids {
        sqlx::query("INSERT INTO coder_rust.memberships VALUES($1,$2)")
            .bind(org)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(
            json!({"id":id,"username":req.username,"email":req.email,"name":req.name,"status":"active","roles":[]}),
        ),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Profile {
    username: String,
    name: String,
    #[serde(default)]
    avatar_url: String,
}
pub(crate) async fn profile(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<Profile>,
) -> Result {
    let actor = actor(&app, &headers).await?;
    let id = crate::target(&actor, &id)?;
    crate::name(&req.username)?;
    if req.name.len() > 128 || req.name.trim() != req.name || req.avatar_url.len() > 2048 {
        return Err(Error::bad("Invalid name or avatar URL."));
    }
    sqlx::query("UPDATE coder_rust.users SET username=$1,name=$2,avatar_url=$3 WHERE id=$4")
        .bind(req.username)
        .bind(req.name)
        .bind(req.avatar_url)
        .bind(id)
        .execute(&app.pool)
        .await?;
    Ok(Json(json!({"message":"Profile updated."})))
}
