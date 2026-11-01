use crate::{App, Error, Result, auth};
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
use uuid::Uuid;

pub(crate) async fn environment(
    app: &App,
    conn: &mut sqlx::PgConnection,
    user: Uuid,
) -> Result<Value> {
    let rows: Vec<(String, String, Vec<u8>, Vec<u8>)> = sqlx::query_as("SELECT name,env_name,nonce,ciphertext FROM coder_rust.secrets WHERE user_id=$1 AND enabled AND env_name<>'' ORDER BY name")
        .bind(user).fetch_all(conn).await?;
    let mut values = serde_json::Map::new();
    if rows.is_empty() {
        return Ok(Value::Object(values));
    }
    let key = app.secret_key.ok_or_else(|| {
        Error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Secret encryption key is unavailable.".into(),
        )
    })?;
    let cipher = Aes256Gcm::new_from_slice(&key).expect("256-bit key");
    for (name, env, nonce, ciphertext) in rows {
        if nonce.len() != 12 {
            return Err(Error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Invalid stored secret nonce.".into(),
            ));
        }
        let aad = format!("{user}:{name}");
        let plaintext = cipher
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
                    "Stored secret could not be decrypted. Check the encryption key.".into(),
                )
            })?;
        let plaintext = String::from_utf8(plaintext).map_err(|_| {
            Error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Invalid stored secret encoding.".into(),
            )
        })?;
        values.insert(env, Value::String(plaintext));
    }
    Ok(Value::Object(values))
}

pub(crate) async fn capabilities(State(app): State<App>, headers: HeaderMap) -> Result {
    auth::actor(&app, &headers).await?;
    Ok(Json(json!({"file_path_delivery_enabled":false})))
}
pub(crate) async fn list(
    State(app): State<App>,
    headers: HeaderMap,
    Path(user): Path<String>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    let user = crate::target(&actor, &user)?;
    let rows:Vec<(Uuid,String,String,String,bool)>=sqlx::query_as("SELECT id,name,description,env_name,enabled FROM coder_rust.secrets WHERE user_id=$1 ORDER BY name")
        .bind(user).fetch_all(&app.pool).await?;
    Ok(Json(json!(rows.into_iter().map(|(id,name,description,env_name,enabled)|json!({"id":id,"name":name,"description":description,"env_name":env_name,"file_path":"","enabled":enabled})).collect::<Vec<_>>())))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CreateSecret {
    name: String,
    value: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    env_name: String,
    #[serde(default)]
    file_path: String,
    enabled: Option<bool>,
}
pub(crate) async fn create(
    State(app): State<App>,
    headers: HeaderMap,
    Path(user): Path<String>,
    Json(req): Json<CreateSecret>,
) -> Result<(StatusCode, Json<Value>)> {
    let actor = auth::actor(&app, &headers).await?;
    let user = crate::target(&actor, &user)?;
    let key = app.secret_key.ok_or_else(|| {
        Error(
            StatusCode::NOT_IMPLEMENTED,
            "Configure CODER_ENCRYPTION_KEY before storing secrets.".into(),
        )
    })?;
    let errors = coder_core::secrets::validate_create(&coder_core::secrets::CreateSecretRequest {
        name: &req.name,
        value: &req.value,
        env_name: &req.env_name,
        file_path: &req.file_path,
        enabled: req.enabled,
    });
    if !errors.is_empty() || req.description.len() > 4096 {
        return Err(Error::bad("Invalid secret fields or injection target."));
    }
    if !req.file_path.is_empty() {
        return Err(Error::bad(
            "File delivery is not implemented by the Rust provisioner protocol.",
        ));
    }
    let mut nonce = [0; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let aad = format!("{user}:{}", req.name);
    let cipher = Aes256Gcm::new_from_slice(&key).expect("256-bit key");
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: req.value.as_bytes(),
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| {
            Error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Secret encryption failed.".into(),
            )
        })?;
    let bytes = (ciphertext.len() + nonce.len()) as i64;
    let enabled = req.enabled.unwrap_or(true);
    let id = Uuid::new_v4();
    let mut tx = app.pool.begin().await?;
    sqlx::query("SELECT id FROM coder_rust.users WHERE id=$1 FOR UPDATE")
        .bind(user)
        .fetch_one(&mut *tx)
        .await?;
    let (count,total,env):(i64,i64,i64)=sqlx::query_as("SELECT count(*),coalesce(sum(value_bytes),0)::bigint,coalesce(sum(value_bytes) FILTER (WHERE env_name<>'' AND enabled),0)::bigint FROM coder_rust.secrets WHERE user_id=$1")
        .bind(user).fetch_one(&mut *tx).await?;
    if count >= 50
        || total + bytes > 200 * 1024
        || (enabled && !req.env_name.is_empty() && env + bytes > 24 * 1024)
    {
        return Err(Error::bad(
            "Per-user secret count or stored-byte budget exceeded.",
        ));
    }
    sqlx::query("INSERT INTO coder_rust.secrets(id,user_id,name,description,env_name,enabled,nonce,ciphertext,value_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)")
        .bind(id).bind(user).bind(&req.name).bind(&req.description).bind(&req.env_name).bind(enabled).bind(nonce.as_slice()).bind(ciphertext).bind(bytes as i32).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(
            json!({"id":id,"name":req.name,"description":req.description,"env_name":req.env_name,"file_path":"","enabled":enabled}),
        ),
    ))
}
pub(crate) async fn delete(
    State(app): State<App>,
    headers: HeaderMap,
    Path((user, name)): Path<(String, String)>,
) -> Result<StatusCode> {
    let actor = auth::actor(&app, &headers).await?;
    let user = crate::target(&actor, &user)?;
    sqlx::query("DELETE FROM coder_rust.secrets WHERE user_id=$1 AND name=$2")
        .bind(user)
        .bind(name)
        .execute(&app.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
