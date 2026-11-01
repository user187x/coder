use crate::{Error, Result};
use serde::{Serialize, de::DeserializeOwned};
use sqlx::PgConnection;

pub(crate) async fn read<T: DeserializeOwned + Default>(
    conn: &mut PgConnection,
    key: &str,
) -> Result<T> {
    let value: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT value FROM coder_rust.deployment_settings WHERE key=$1")
            .bind(key)
            .fetch_optional(conn)
            .await?;
    value
        .map(serde_json::from_value)
        .transpose()
        .map_err(|_| Error::bad("Stored deployment settings are invalid."))
        .map(Option::unwrap_or_default)
}

pub(crate) async fn write<T: Serialize>(
    conn: &mut PgConnection,
    key: &str,
    value: &T,
) -> Result<()> {
    sqlx::query("INSERT INTO coder_rust.deployment_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()")
        .bind(key).bind(serde_json::to_value(value).map_err(|_| Error::bad("Invalid deployment settings."))?).execute(conn).await?;
    Ok(())
}
