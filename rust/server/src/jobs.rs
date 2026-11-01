use crate::{
    App, Error, Result, auth,
    workspaces::{self, Build},
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

pub(crate) async fn worker(app: &App, headers: &HeaderMap) -> Result<(Uuid, Uuid)> {
    let token = crate::header(headers, "Coder-Provisioner-Token")?;
    sqlx::query_as("SELECT id,organization_id FROM coder_rust.provisioner_keys WHERE token_hash=$1")
        .bind(auth::digest(token))
        .fetch_optional(&app.pool)
        .await?
        .ok_or_else(|| {
            Error(
                StatusCode::UNAUTHORIZED,
                "Invalid provisioner token.".into(),
            )
        })
}
pub(crate) async fn create_key(
    State(app): State<App>,
    headers: HeaderMap,
    Path(org): Path<Uuid>,
) -> Result<(StatusCode, Json<Value>)> {
    let actor = auth::actor(&app, &headers).await?;
    actor.admin()?;
    crate::member(&app, actor.id, org).await?;
    let key = auth::token();
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO coder_rust.provisioner_keys VALUES($1,$2,$3)")
        .bind(id)
        .bind(org)
        .bind(auth::digest(&key))
        .execute(&app.pool)
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"id":id,"organization_id":org,"key":key})),
    ))
}
pub(crate) async fn delete_key(
    State(app): State<App>,
    headers: HeaderMap,
    Path((org, id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode> {
    let actor = auth::actor(&app, &headers).await?;
    actor.admin()?;
    crate::member(&app, actor.id, org).await?;
    sqlx::query("DELETE FROM coder_rust.provisioner_keys WHERE id=$1 AND organization_id=$2")
        .bind(id)
        .bind(org)
        .execute(&app.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize, Default)]
pub(crate) struct ClaimQuery {
    driver: Option<String>,
}

pub(crate) async fn claim(
    State(app): State<App>,
    headers: HeaderMap,
    Query(query): Query<ClaimQuery>,
) -> Result {
    let (worker, org) = worker(&app, &headers).await?;
    let mut tx = app.pool.begin().await?;
    sqlx::query("WITH expired AS (UPDATE coder_rust.builds SET status='failed',completed_at=now(),lease_hash=NULL WHERE organization_id=$1 AND status IN ('starting','stopping','deleting') AND lease_expires_at<=now() RETURNING id) INSERT INTO coder_rust.build_logs(build_id,log_level,output) SELECT id,'error','Provisioner lease expired. Inspect infrastructure before retrying.' FROM expired")
        .bind(org).execute(&mut *tx).await?;
    let build=sqlx::query_as::<_,Build>("SELECT b.* FROM coder_rust.builds b JOIN coder_rust.template_versions v ON v.id=b.template_version_id WHERE b.organization_id=$1 AND b.status='pending' AND ($2::text IS NULL OR v.provisioner_spec->>'driver'=$2) AND NOT EXISTS(SELECT 1 FROM coder_rust.provisioner_states s WHERE s.workspace_id=b.workspace_id AND s.dirty) ORDER BY b.created_at,b.id FOR UPDATE OF b SKIP LOCKED LIMIT 1").bind(org).bind(query.driver).fetch_optional(&mut *tx).await?;
    let Some(build) = build else {
        tx.commit().await?;
        return Ok(Json(Value::Null));
    };
    let token = auth::token();
    let status = match build.transition.as_str() {
        "start" => "starting",
        "stop" => "stopping",
        _ => "deleting",
    };
    sqlx::query("UPDATE coder_rust.builds SET status=$1,worker_id=$2,lease_hash=$3,lease_expires_at=now()+interval '5 minutes' WHERE id=$4")
        .bind(status).bind(worker).bind(auth::digest(&token)).bind(build.id).execute(&mut *tx).await?;
    let spec: Value =
        sqlx::query_scalar("SELECT provisioner_spec FROM coder_rust.template_versions WHERE id=$1")
            .bind(build.template_version_id)
            .fetch_one(&mut *tx)
            .await?;
    if spec["driver"] == "terraform" && app.secret_key.is_none() {
        return Err(Error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Configure CODER_ENCRYPTION_KEY before claiming Terraform jobs.".into(),
        ));
    }
    let parameter_schema: Value =
        sqlx::query_scalar("SELECT parameters FROM coder_rust.template_versions WHERE id=$1")
            .bind(build.template_version_id)
            .fetch_one(&mut *tx)
            .await?;
    let owner: Uuid = sqlx::query_scalar("SELECT owner_id FROM coder_rust.workspaces WHERE id=$1")
        .bind(build.workspace_id)
        .fetch_one(&mut *tx)
        .await?;
    let environment = if build.transition == "start" || spec["driver"] == "terraform" {
        crate::secrets::environment(&app, &mut tx, owner).await?
    } else {
        json!({})
    };
    tx.commit().await?;
    Ok(Json(
        json!({"id":build.id,"organization_id":org,"workspace_id":build.workspace_id,"transition":build.transition,"template_version_id":build.template_version_id,
        "parameters":build.parameters,"parameter_schema":parameter_schema,"provisioner_spec":spec,"environment":environment,"lease_token":token,"lease_seconds":300}),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Lease {
    lease_token: String,
}
pub(crate) async fn check(
    conn: &mut sqlx::PgConnection,
    id: Uuid,
    org: Uuid,
    worker: Uuid,
    token: &str,
) -> Result<Build> {
    sqlx::query_as::<_,Build>("SELECT * FROM coder_rust.builds WHERE id=$1 AND organization_id=$2 AND worker_id=$3 AND lease_hash=$4 AND lease_expires_at>now() AND status IN ('starting','stopping','deleting') FOR UPDATE")
        .bind(id).bind(org).bind(worker).bind(auth::digest(token)).fetch_optional(conn).await?.ok_or_else(||Error::conflict("Build lease expired, canceled, completed, or belongs to another worker."))
}
pub(crate) async fn heartbeat(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<Lease>,
) -> Result {
    let (worker, org) = worker(&app, &headers).await?;
    let mut tx = app.pool.begin().await?;
    check(&mut tx, id, org, worker, &req.lease_token).await?;
    sqlx::query(
        "UPDATE coder_rust.builds SET lease_expires_at=now()+interval '5 minutes' WHERE id=$1",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"lease_seconds":300})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Logs {
    lease_token: String,
    entries: Vec<Log>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Log {
    log_level: String,
    output: String,
}
pub(crate) async fn logs(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<Logs>,
) -> Result {
    let (worker, org) = worker(&app, &headers).await?;
    if req.entries.len() > 100
        || req.entries.iter().any(|e| {
            e.output.len() > 8192
                || !matches!(
                    e.log_level.as_str(),
                    "trace" | "debug" | "info" | "warn" | "error"
                )
        })
    {
        return Err(Error::bad(
            "At most 100 log entries of 8192 bytes with a supported level are allowed.",
        ));
    }
    let mut tx = app.pool.begin().await?;
    check(&mut tx, id, org, worker, &req.lease_token).await?;
    for entry in req.entries {
        sqlx::query(
            "INSERT INTO coder_rust.build_logs(build_id,log_level,output) VALUES($1,$2,$3)",
        )
        .bind(id)
        .bind(entry.log_level)
        .bind(entry.output)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"message":"Logs accepted."})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Complete {
    state_revision: Option<i64>,
    lease_token: String,
    success: bool,
    #[serde(default)]
    resources: Vec<Value>,
    #[serde(default)]
    error: String,
}
pub(crate) fn completed_status(transition: &str, success: bool) -> Result<&'static str> {
    if !success {
        return Ok("failed");
    }
    match transition {
        "start" => Ok("running"),
        "stop" => Ok("stopped"),
        "delete" => Ok("deleted"),
        _ => Err(Error::bad("Unknown transition.")),
    }
}
pub(crate) async fn complete(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<Complete>,
) -> Result {
    let (worker, org) = worker(&app, &headers).await?;
    if req.error.len() > 8192 || req.resources.len() > 100 {
        return Err(Error::bad("Completion output is too large."));
    }
    for resource in &req.resources {
        if resource["name"].as_str().is_none()
            || resource["type"].as_str().is_none()
            || resource["hide"].as_bool().is_none()
        {
            return Err(Error::bad("Resources require name, type, and hide fields."));
        }
        if let Some(agents) = resource["agents"].as_array() {
            for agent in agents {
                for field in ["name", "status", "operating_system", "architecture"] {
                    if agent[field].as_str().is_none() {
                        return Err(Error::bad("Invalid agent resource metadata."));
                    }
                }
            }
        }
    }
    let mut tx = app.pool.begin().await?;
    let build = check(&mut tx, id, org, worker, &req.lease_token).await?;
    let spec: Value =
        sqlx::query_scalar("SELECT provisioner_spec FROM coder_rust.template_versions WHERE id=$1")
            .bind(build.template_version_id)
            .fetch_one(&mut *tx)
            .await?;
    if spec["driver"] == "terraform" {
        let (revision, dirty) = crate::state::metadata(&mut tx, build.workspace_id).await?;
        if (dirty && req.success) || req.state_revision != Some(revision) {
            return Err(Error::conflict(
                "Checkpoint the current Terraform state before completing this build.",
            ));
        }
        if req.success && revision == 0 {
            return Err(Error::conflict(
                "Terraform success requires a durable state checkpoint.",
            ));
        }
    }
    let status = completed_status(&build.transition, req.success)?;
    sqlx::query("UPDATE coder_rust.builds SET status=$1,resources=$2,completed_at=now(),lease_hash=NULL WHERE id=$3")
        .bind(status).bind(json!(req.resources)).bind(id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO coder_rust.build_logs(build_id,log_level,output) VALUES($1,$2,$3)")
        .bind(id)
        .bind(if req.success { "info" } else { "error" })
        .bind(if req.error.is_empty() {
            format!("Build completed: {status}.")
        } else {
            req.error
        })
        .execute(&mut *tx)
        .await?;
    if status == "deleted" {
        sqlx::query("UPDATE coder_rust.workspaces SET deleted=true WHERE id=$1")
            .bind(build.workspace_id)
            .execute(&mut *tx)
            .await?;
    }
    if status == "stopped" && build.on_success {
        let row:(Uuid,Uuid,i32,Value)=sqlx::query_as("SELECT t.active_version_id,w.owner_id,b.build_number,b.parameters FROM coder_rust.workspaces w JOIN coder_rust.templates t ON t.id=w.template_id JOIN coder_rust.builds b ON b.id=w.latest_build_id WHERE w.id=$1 AND w.latest_build_id=$2 FOR UPDATE OF w")
            .bind(build.workspace_id).bind(id).fetch_one(&mut *tx).await?;
        let active:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM coder_rust.users u JOIN coder_rust.memberships m ON m.user_id=u.id WHERE u.id=$1 AND u.status='active' AND m.organization_id=$2)").bind(row.1).bind(org).fetch_one(&mut *tx).await?;
        if active {
            // A changed active version can invalidate parameters. Keep the stop
            // committed and let the owner resolve it, rather than undoing reality.
            let params =
                crate::catalog::validate_parameters(&mut tx, row.0, None, Some(row.3)).await;
            match params {
                Ok(params) => {
                    workspaces::insert_build(
                        &mut tx,
                        Uuid::new_v4(),
                        org,
                        build.workspace_id,
                        row.2 + 1,
                        row.0,
                        "start",
                        params,
                        false,
                    )
                    .await?
                }
                Err(_) => {
                    sqlx::query("INSERT INTO coder_rust.build_logs(build_id,log_level,output) VALUES($1,'error','Restart not queued: review parameters for the active template version.')").bind(id).execute(&mut *tx).await?;
                }
            }
        }
    }
    tx.commit().await?;
    Ok(Json(json!({"status":status})))
}

#[cfg(test)]
mod tests {
    #[test]
    fn successful_results_map_to_real_terminal_states() {
        for (transition, status) in [
            ("start", "running"),
            ("stop", "stopped"),
            ("delete", "deleted"),
        ] {
            assert_eq!(super::completed_status(transition, true).unwrap(), status);
            assert_eq!(
                super::completed_status(transition, false).unwrap(),
                "failed"
            );
        }
        assert!(super::completed_status("unknown", true).is_err());
    }
}
