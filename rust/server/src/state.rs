use crate::{App, Error, Result, auth, jobs};
use aes_gcm::{
    Aes256Gcm, KeyInit, Nonce,
    aead::{Aead, Payload},
};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use rand::RngCore;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgConnection;
use uuid::Uuid;

const MAX_STATE: usize = 4 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Read {
    lease_token: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Write {
    lease_token: String,
    revision: i64,
    state: Value,
    dirty: bool,
}

pub(crate) async fn metadata(conn: &mut PgConnection, workspace: Uuid) -> Result<(i64, bool)> {
    Ok(sqlx::query_as(
        "SELECT revision,dirty FROM coder_rust.provisioner_states WHERE workspace_id=$1",
    )
    .bind(workspace)
    .fetch_optional(conn)
    .await?
    .unwrap_or((0, false)))
}

fn key(app: &App) -> Result<Aes256Gcm> {
    let key = app.secret_key.ok_or_else(|| {
        Error(
            StatusCode::SERVICE_UNAVAILABLE,
            "CODER_ENCRYPTION_KEY is required for Terraform state storage.".into(),
        )
    })?;
    Ok(Aes256Gcm::new_from_slice(&key).expect("256-bit key"))
}

fn validate(state: &Value) -> Result<()> {
    if !state.is_null() && (!state.is_object() || state["version"].as_u64().is_none()) {
        return Err(Error::bad(
            "State must be null or a Terraform state object with a version.",
        ));
    }
    Ok(())
}

async fn save(
    app: &App,
    conn: &mut PgConnection,
    workspace: Uuid,
    org: Uuid,
    revision: i64,
    state: &Value,
    dirty: bool,
) -> Result<i64> {
    validate(state)?;
    let bytes = serde_json::to_vec(state).map_err(|_| Error::bad("Invalid state JSON."))?;
    if bytes.len() > MAX_STATE {
        return Err(Error::bad("Terraform state exceeds 4 MiB."));
    }
    let cipher = key(app)?;
    let mut nonce = [0; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let aad = format!("terraform:{org}:{workspace}");
    let encrypted = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &bytes,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| {
            Error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "State encryption failed.".into(),
            )
        })?;
    let current = metadata(conn, workspace).await?;
    if current.0 != revision || revision == i64::MAX {
        return Err(Error::conflict("Terraform state revision changed."));
    }
    let next = revision + 1;
    sqlx::query("INSERT INTO coder_rust.provisioner_states(workspace_id,organization_id,revision,dirty,nonce,ciphertext) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id) DO UPDATE SET revision=EXCLUDED.revision,dirty=EXCLUDED.dirty,nonce=EXCLUDED.nonce,ciphertext=EXCLUDED.ciphertext,updated_at=now()")
        .bind(workspace).bind(org).bind(next).bind(dirty).bind(nonce.as_slice()).bind(encrypted).execute(conn).await?;
    Ok(next)
}

pub(crate) async fn read(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<Read>,
) -> Result {
    let (worker, org) = jobs::worker(&app, &headers).await?;
    let mut tx = app.pool.begin().await?;
    let build = jobs::check(&mut tx, id, org, worker, &req.lease_token).await?;
    let stored: Option<(i64, bool, Vec<u8>, Vec<u8>)> = sqlx::query_as("SELECT revision,dirty,nonce,ciphertext FROM coder_rust.provisioner_states WHERE workspace_id=$1 AND organization_id=$2")
        .bind(build.workspace_id).bind(org).fetch_optional(&mut *tx).await?;
    let response = if let Some((revision, dirty, nonce, ciphertext)) = stored {
        if nonce.len() != 12 {
            return Err(Error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Invalid stored state nonce.".into(),
            ));
        }
        let aad = format!("terraform:{org}:{}", build.workspace_id);
        let bytes = key(&app)?
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &ciphertext,
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| {
                Error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Terraform state could not be decrypted. Check the encryption key.".into(),
                )
            })?;
        let state: Value = serde_json::from_slice(&bytes).map_err(|_| {
            Error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Invalid stored state JSON.".into(),
            )
        })?;
        json!({"revision":revision,"dirty":dirty,"state":state})
    } else {
        json!({"revision":0,"dirty":false,"state":null})
    };
    tx.commit().await?;
    Ok(Json(response))
}

pub(crate) async fn write(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<Write>,
) -> Result {
    let (worker, org) = jobs::worker(&app, &headers).await?;
    let mut tx = app.pool.begin().await?;
    let build = jobs::check(&mut tx, id, org, worker, &req.lease_token).await?;
    sqlx::query("SELECT id FROM coder_rust.workspaces WHERE id=$1 FOR UPDATE")
        .bind(build.workspace_id)
        .fetch_one(&mut *tx)
        .await?;
    let revision = save(
        &app,
        &mut tx,
        build.workspace_id,
        org,
        req.revision,
        &req.state,
        req.dirty,
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"revision":revision})))
}

pub(crate) async fn inspect(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    crate::workspaces::authorized_action(&app, &actor, id, "workspace.state.read").await?;
    let (revision, dirty) = metadata(&mut *app.pool.acquire().await?, id).await?;
    Ok(Json(json!({"revision":revision,"recovery_required":dirty})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Recover {
    revision: i64,
    state: Value,
    confirm_workspace_id: Uuid,
}

pub(crate) async fn recover(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<Recover>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    let workspace =
        crate::workspaces::authorized_action(&app, &actor, id, "workspace.state.recover").await?;
    if req.confirm_workspace_id != id {
        return Err(Error::bad(
            "Confirm the exact workspace ID before recovering state.",
        ));
    }
    let mut tx = app.pool.begin().await?;
    sqlx::query("SELECT id FROM coder_rust.workspaces WHERE id=$1 FOR UPDATE")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    let active: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM coder_rust.builds WHERE workspace_id=$1 AND status IN ('starting','stopping','deleting') AND lease_expires_at>now())")
        .bind(id).fetch_one(&mut *tx).await?;
    if active {
        return Err(Error::conflict(
            "Stop the active provisioner before recovering Terraform state.",
        ));
    }
    let revision = save(
        &app,
        &mut tx,
        id,
        workspace.organization_id,
        req.revision,
        &req.state,
        false,
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"revision":revision})))
}
