use crate::{App, Error, Result, auth, catalog};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{FromRow, PgConnection};
use uuid::Uuid;

#[derive(FromRow)]
pub(crate) struct Workspace {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub owner_id: Uuid,
    pub template_id: Uuid,
    pub name: String,
    pub latest_build_id: Uuid,
    pub favorite: bool,
    pub owner_name: String,
    pub template_name: String,
    pub template_display_name: String,
    pub active_version_id: Uuid,
}
pub(crate) const WORKSPACE: &str = "SELECT w.id,w.organization_id,w.owner_id,w.template_id,w.name,w.latest_build_id,w.favorite,u.username AS owner_name,t.name AS template_name,t.display_name AS template_display_name,t.active_version_id FROM coder_rust.workspaces w JOIN coder_rust.users u ON u.id=w.owner_id JOIN coder_rust.templates t ON t.id=w.template_id";
impl Workspace {
    pub async fn json(&self, conn: &mut PgConnection, actor: Uuid) -> Result<Value> {
        let build = sqlx::query_as::<_, Build>("SELECT * FROM coder_rust.builds WHERE id=$1")
            .bind(self.latest_build_id)
            .fetch_one(&mut *conn)
            .await?;
        let (_, dirty) = crate::state::metadata(conn, self.id).await?;
        let recovery = dirty && !pending(&build.status);
        let available:Vec<String>=sqlx::query_scalar("SELECT action FROM unnest($1::text[]) AS action WHERE coder_rust.permitted($2,$3,action,$4,$5 AND action <> 'workspace.state.recover')")
            .bind(crate::rbac::ACTIONS.iter().filter(|a|a.starts_with("workspace.") && **a!="workspace.create").copied().collect::<Vec<_>>()).bind(actor).bind(self.organization_id).bind(self.id).bind(self.owner_id==actor).fetch_all(&mut *conn).await?;
        Ok(
            json!({"id":self.id,"organization_id":self.organization_id,"owner_id":self.owner_id,"owner_name":self.owner_name,
            "name":self.name,"template_id":self.template_id,"template_name":self.template_name,"template_display_name":self.template_display_name,
            "template_active_version_id":self.active_version_id,"favorite":self.favorite,"outdated":build.template_version_id!=self.active_version_id,"latest_build":build.json(),"infrastructure_recovery_required":recovery,"available_actions":available}),
        )
    }
}
#[derive(FromRow)]
pub(crate) struct Build {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub workspace_id: Uuid,
    pub build_number: i32,
    pub template_version_id: Uuid,
    pub transition: String,
    pub status: String,
    pub parameters: Value,
    pub resources: Value,
    pub on_success: bool,
}
impl Build {
    pub fn json(&self) -> Value {
        json!({"id":self.id,"organization_id":self.organization_id,"workspace_id":self.workspace_id,"build_number":self.build_number,"template_version_id":self.template_version_id,"transition":self.transition,"status":self.status,"resources":self.resources})
    }
}
pub(crate) async fn authorized(app: &App, actor: &auth::User, id: Uuid) -> Result<Workspace> {
    authorized_action(app, actor, id, "workspace.read").await
}
pub(crate) async fn authorized_action(
    app: &App,
    actor: &auth::User,
    id: Uuid,
    action: &str,
) -> Result<Workspace> {
    let row =
        sqlx::query_as::<_, Workspace>(&format!("{WORKSPACE} WHERE w.id=$1 AND NOT w.deleted"))
            .bind(id)
            .fetch_one(&app.pool)
            .await?;
    crate::rbac::require(
        app,
        actor,
        row.organization_id,
        action,
        Some(row.id),
        row.owner_id == actor.id && action != "workspace.state.recover",
    )
    .await?;
    Ok(row)
}
pub(crate) async fn get(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    let row = authorized(&app, &actor, id).await?;
    Ok(Json(
        row.json(&mut *app.pool.acquire().await?, actor.id).await?,
    ))
}
pub(crate) async fn list(
    State(app): State<App>,
    headers: HeaderMap,
    Query(search): Query<auth::Search>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    let (offset, limit) = search.page()?;
    let mut term = String::new();
    let mut status = String::new();
    let mut own = false;
    for word in search.q.split_whitespace() {
        if word == "owner:me" {
            own = true;
            continue;
        }
        if let Some(value) = word.strip_prefix("status:") {
            status = value.to_owned();
        } else if word.contains(':') {
            return Err(Error::bad(
                "Supported filters are owner:me and status:<state>.",
            ));
        } else {
            if !term.is_empty() {
                term.push(' ');
            }
            term.push_str(word);
        }
    }
    let filter = " JOIN coder_rust.builds b ON b.id=w.latest_build_id WHERE coder_rust.permitted($1,w.organization_id,'workspace.read',w.id,w.owner_id=$1) AND (NOT $4 OR w.owner_id=$1) AND NOT w.deleted AND w.name ILIKE $2 AND ($3='' OR b.status=$3)";
    let rows = sqlx::query_as::<_, Workspace>(&format!(
        "{WORKSPACE}{filter} ORDER BY w.created_at DESC LIMIT $5 OFFSET $6"
    ))
    .bind(actor.id)
    .bind(format!("%{term}%"))
    .bind(&status)
    .bind(own)
    .bind(limit)
    .bind(offset)
    .fetch_all(&app.pool)
    .await?;
    let count: i64 = sqlx::query_scalar(&format!(
        "SELECT count(*) FROM coder_rust.workspaces w{filter}"
    ))
    .bind(actor.id)
    .bind(format!("%{term}%"))
    .bind(status)
    .bind(own)
    .fetch_one(&app.pool)
    .await?;
    let mut values = Vec::new();
    let mut conn = app.pool.acquire().await?;
    for row in rows {
        values.push(row.json(&mut conn, actor.id).await?);
    }
    Ok(Json(json!({"workspaces":values,"count":count})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CreateWorkspace {
    name: String,
    template_version_id: Option<Uuid>,
    template_id: Option<Uuid>,
    rich_parameter_values: Option<Vec<catalog::ParameterValue>>,
}
pub(crate) async fn create(
    State(app): State<App>,
    headers: HeaderMap,
    Path(user): Path<String>,
    Json(req): Json<CreateWorkspace>,
) -> Result<(StatusCode, Json<Value>)> {
    let actor = auth::actor(&app, &headers).await?;
    let owner = crate::target(&actor, &user)?;
    crate::name(&req.name)?;
    let template = match (req.template_id, req.template_version_id) {
        (Some(id), None) => {
            sqlx::query_as::<_, catalog::Template>(&format!("{} WHERE t.id=$1", catalog::TEMPLATE))
                .bind(id)
                .fetch_one(&app.pool)
                .await?
        }
        (None, Some(id)) => {
            sqlx::query_as::<_, catalog::Template>(&format!(
                "{} JOIN coder_rust.template_versions v ON v.template_id=t.id WHERE v.id=$1",
                catalog::TEMPLATE
            ))
            .bind(id)
            .fetch_one(&app.pool)
            .await?
        }
        _ => {
            return Err(Error::bad(
                "Provide exactly one of template_id or template_version_id.",
            ));
        }
    };
    crate::rbac::require(
        &app,
        &actor,
        template.organization_id,
        "workspace.create",
        None,
        true,
    )
    .await?;
    crate::rbac::require(
        &app,
        &actor,
        template.organization_id,
        "template.use",
        Some(template.id),
        true,
    )
    .await?;
    crate::member(&app, owner, template.organization_id).await?;
    let version = req
        .template_version_id
        .unwrap_or(template.active_version_id);
    let id = Uuid::new_v4();
    let build = Uuid::new_v4();
    let mut tx = app.pool.begin().await?;
    let params =
        catalog::validate_parameters(&mut tx, version, req.rich_parameter_values, None).await?;
    sqlx::query("INSERT INTO coder_rust.workspaces(id,organization_id,owner_id,template_id,name) VALUES($1,$2,$3,$4,$5)")
        .bind(id).bind(template.organization_id).bind(owner).bind(template.id).bind(req.name).execute(&mut *tx).await?;
    insert_build(
        &mut tx,
        build,
        template.organization_id,
        id,
        1,
        version,
        "start",
        params,
        false,
    )
    .await?;
    let row = sqlx::query_as::<_, Workspace>(&format!("{WORKSPACE} WHERE w.id=$1"))
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    let value = row.json(&mut tx, actor.id).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(value)))
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_build(
    conn: &mut PgConnection,
    id: Uuid,
    org: Uuid,
    workspace: Uuid,
    number: i32,
    version: Uuid,
    transition: &str,
    params: Value,
    on_success: bool,
) -> Result<()> {
    sqlx::query("INSERT INTO coder_rust.builds(id,organization_id,workspace_id,build_number,template_version_id,transition,status,parameters,on_success) VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8)")
        .bind(id).bind(org).bind(workspace).bind(number).bind(version).bind(transition).bind(params).bind(on_success).execute(&mut *conn).await?;
    sqlx::query("UPDATE coder_rust.workspaces SET latest_build_id=$1 WHERE id=$2")
        .bind(id)
        .bind(workspace)
        .execute(&mut *conn)
        .await?;
    sqlx::query("INSERT INTO coder_rust.build_logs(build_id,log_level,output) VALUES($1,'info','Queued; waiting for an authorized provisioner.')").bind(id).execute(conn).await?;
    Ok(())
}

pub(crate) fn pending(status: &str) -> bool {
    matches!(status, "pending" | "starting" | "stopping" | "deleting")
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct BuildRequest {
    #[serde(default, rename = "reason")]
    _reason: Option<String>,
    transition: String,
    template_version_id: Option<Uuid>,
    rich_parameter_values: Option<Vec<catalog::ParameterValue>>,
    on_success: Option<OnSuccess>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct OnSuccess {
    transition: String,
    template_version_id: Option<Uuid>,
}
pub(crate) async fn build(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<BuildRequest>,
) -> Result<(StatusCode, Json<Value>)> {
    let actor = auth::actor(&app, &headers).await?;
    if !matches!(req.transition.as_str(), "start" | "stop" | "delete") {
        return Err(Error::bad("Unknown workspace transition."));
    }
    let w = authorized_action(&app, &actor, id, &format!("workspace.{}", req.transition)).await?;
    if req.on_success.is_some() {
        authorized_action(&app, &actor, id, "workspace.start").await?;
    }
    if let Some(child) = &req.on_success {
        if req.transition != "stop"
            || child.transition != "start"
            || child.template_version_id.is_some()
        {
            return Err(Error::bad(
                "Queued restarts must stop, then start on the active template version.",
            ));
        }
    }
    let mut tx = app.pool.begin().await?;
    sqlx::query("SELECT id FROM coder_rust.workspaces WHERE id=$1 FOR UPDATE")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    let previous=sqlx::query_as::<_,Build>("SELECT b.* FROM coder_rust.builds b JOIN coder_rust.workspaces w ON w.latest_build_id=b.id WHERE w.id=$1").bind(id).fetch_one(&mut *tx).await?;
    if pending(&previous.status) {
        return Err(Error::conflict("A build is already in progress."));
    }
    if crate::state::metadata(&mut tx, id).await?.1 {
        return Err(Error::conflict(
            "Terraform state requires administrator recovery before further infrastructure changes.",
        ));
    }
    if previous.status == "deleted" {
        return Err(Error::conflict("The workspace is deleted."));
    }
    if req.transition == "start" && previous.status == "running" {
        return Err(Error::conflict("The workspace is already running."));
    }
    if req.transition == "stop" && previous.status == "stopped" {
        return Err(Error::conflict("The workspace is already stopped."));
    }
    let version = req
        .template_version_id
        .unwrap_or(previous.template_version_id);
    let belongs: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM coder_rust.template_versions WHERE id=$1 AND template_id=$2)",
    )
    .bind(version)
    .bind(w.template_id)
    .fetch_one(&mut *tx)
    .await?;
    if !belongs {
        return Err(Error::bad("Template version belongs to another template."));
    }
    let params = if req.transition == "start" {
        catalog::validate_parameters(
            &mut tx,
            version,
            req.rich_parameter_values,
            Some(previous.parameters),
        )
        .await?
    } else {
        previous.parameters
    };
    let next = Uuid::new_v4();
    insert_build(
        &mut tx,
        next,
        w.organization_id,
        id,
        previous.build_number + 1,
        version,
        &req.transition,
        params,
        req.on_success.is_some(),
    )
    .await?;
    let b = sqlx::query_as::<_, Build>("SELECT * FROM coder_rust.builds WHERE id=$1")
        .bind(next)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(b.json())))
}
pub(crate) async fn builds(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    authorized(&app, &actor, id).await?;
    let rows=sqlx::query_as::<_,Build>("SELECT * FROM coder_rust.builds WHERE workspace_id=$1 ORDER BY build_number DESC LIMIT 100").bind(id).fetch_all(&app.pool).await?;
    Ok(Json(json!(
        rows.iter().map(Build::json).collect::<Vec<_>>()
    )))
}
pub(crate) async fn logs(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    let workspace: Uuid =
        sqlx::query_scalar("SELECT workspace_id FROM coder_rust.builds WHERE id=$1")
            .bind(id)
            .fetch_one(&app.pool)
            .await?;
    authorized(&app, &actor, workspace).await?;
    let rows:Vec<(i64,chrono::DateTime<chrono::Utc>,String,String)>=sqlx::query_as("SELECT id,created_at,log_level,output FROM coder_rust.build_logs WHERE build_id=$1 ORDER BY id LIMIT 1000").bind(id).fetch_all(&app.pool).await?;
    Ok(Json(json!(rows.into_iter().map(|(id,time,level,output)|json!({"id":id,"created_at":time,"log_level":level,"output":output})).collect::<Vec<_>>())))
}
pub(crate) async fn cancel(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    let workspace: Uuid =
        sqlx::query_scalar("SELECT workspace_id FROM coder_rust.builds WHERE id=$1")
            .bind(id)
            .fetch_one(&app.pool)
            .await?;
    authorized_action(&app, &actor, workspace, "workspace.cancel").await?;
    let updated=sqlx::query("UPDATE coder_rust.builds SET status='canceled',completed_at=now(),lease_hash=NULL WHERE id=$1 AND status IN ('pending','starting','stopping','deleting')").bind(id).execute(&app.pool).await?;
    if updated.rows_affected() == 0 {
        return Err(Error::conflict("This build is no longer cancelable."));
    }
    Ok(Json(
        json!({"message":"Build canceled. Workers must stop when their lease is rejected."}),
    ))
}
async fn set_favorite(app: App, headers: HeaderMap, id: Uuid, value: bool) -> Result<StatusCode> {
    let actor = auth::actor(&app, &headers).await?;
    let w = authorized(&app, &actor, id).await?;
    if w.owner_id != actor.id {
        return Err(Error::forbidden());
    }
    sqlx::query("UPDATE coder_rust.workspaces SET favorite=$1 WHERE id=$2")
        .bind(value)
        .bind(id)
        .execute(&app.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
pub(crate) async fn favorite(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode> {
    set_favorite(app, headers, id, true).await
}
pub(crate) async fn unfavorite(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode> {
    set_favorite(app, headers, id, false).await
}
