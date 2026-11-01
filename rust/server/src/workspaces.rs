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
    pub autostart_schedule: Option<String>,
    pub ttl_ms: Option<i64>,
    pub automatic_updates: String,
    pub next_start_at: Option<chrono::DateTime<chrono::Utc>>,
}
pub(crate) const WORKSPACE: &str = "SELECT w.id,w.organization_id,w.owner_id,w.template_id,w.name,w.latest_build_id,w.favorite,w.autostart_schedule,w.ttl_ms,w.automatic_updates,w.next_start_at,u.username AS owner_name,t.name AS template_name,t.display_name AS template_display_name,t.active_version_id FROM coder_rust.workspaces w JOIN coder_rust.users u ON u.id=w.owner_id JOIN coder_rust.templates t ON t.id=w.template_id";
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
            "autostart_schedule":self.autostart_schedule,"ttl_ms":self.ttl_ms,"automatic_updates":self.automatic_updates,"next_start_at":self.next_start_at,"template_active_version_id":self.active_version_id,"favorite":self.favorite,"outdated":build.template_version_id!=self.active_version_id,"latest_build":build.json(),"infrastructure_recovery_required":recovery,"available_actions":available}),
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
    pub deadline: Option<chrono::DateTime<chrono::Utc>>,
    pub max_deadline: Option<chrono::DateTime<chrono::Utc>>,
    pub reason: String,
}
impl Build {
    pub fn json(&self) -> Value {
        json!({"id":self.id,"organization_id":self.organization_id,"workspace_id":self.workspace_id,"build_number":self.build_number,"template_version_id":self.template_version_id,"transition":self.transition,"status":self.status,"resources":self.resources,"deadline":self.deadline,"max_deadline":self.max_deadline,"reason":self.reason})
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
    let filter = crate::workspace_search::Filter::parse(&search.q)?;
    let target_user: Option<Uuid> = if filter.user.is_empty() {
        None
    } else if filter.user == "me" {
        Some(actor.id)
    } else {
        Some(
            sqlx::query_scalar(
                "SELECT id FROM coder_rust.users WHERE lower(username)=$1 OR id::text=$1",
            )
            .bind(&filter.user)
            .fetch_one(&app.pool)
            .await?,
        )
    };
    let mut query = workspace_query(WORKSPACE, &filter, &actor, target_user);
    query
        .push(" ORDER BY (w.favorite AND w.owner_id=")
        .push_bind(actor.id)
        .push(") DESC,(w.owner_id=")
        .push_bind(actor.id)
        .push(") DESC,(b.status='running') DESC,lower(u.username),lower(w.name),w.id LIMIT ")
        .push_bind(limit)
        .push(" OFFSET ")
        .push_bind(offset);
    let rows = query
        .build_query_as::<Workspace>()
        .fetch_all(&app.pool)
        .await?;
    let count: i64 = workspace_query(
        "SELECT count(*) FROM coder_rust.workspaces w JOIN coder_rust.users u ON u.id=w.owner_id JOIN coder_rust.templates t ON t.id=w.template_id",
        &filter, &actor, target_user,
    ).build_query_scalar().fetch_one(&app.pool).await?;
    let mut values = Vec::new();
    let mut conn = app.pool.acquire().await?;
    for row in rows {
        values.push(row.json(&mut conn, actor.id).await?);
    }
    Ok(Json(json!({"workspaces":values,"count":count})))
}

fn workspace_query<'a>(
    prefix: &'a str,
    filter: &'a crate::workspace_search::Filter,
    actor: &'a auth::User,
    target_user: Option<Uuid>,
) -> sqlx::QueryBuilder<'a, sqlx::Postgres> {
    let mut query = sqlx::QueryBuilder::new(prefix);
    query.push(" JOIN coder_rust.builds b ON b.id=w.latest_build_id JOIN coder_rust.organizations o ON o.id=w.organization_id WHERE NOT w.deleted AND coder_rust.permitted(")
        .push_bind(actor.id).push(",w.organization_id,'workspace.read',w.id,w.owner_id=").push_bind(actor.id).push(")");
    if !filter.name.is_empty() {
        query
            .push(" AND w.name ILIKE ")
            .push_bind(format!("%{}%", filter.name));
    }
    if !filter.owner.is_empty() {
        if filter.owner == "me" {
            query.push(" AND w.owner_id=").push_bind(actor.id);
        } else {
            query
                .push(" AND lower(u.username)=")
                .push_bind(&filter.owner);
        }
    }
    if let Some(user) = target_user {
        // Explicit resource grants are the Rust runtime's sharing mechanism.
        // An org-wide administrator role does not mean every workspace was shared.
        query.push(" AND (w.owner_id=").push_bind(user)
            .push(" OR (coder_rust.permitted(").push_bind(user)
            .push(",w.organization_id,'workspace.read',w.id,false) AND EXISTS (SELECT 1 FROM coder_rust.role_bindings rb JOIN coder_rust.role_permissions rp USING(organization_id,role_id) WHERE rb.user_id=")
            .push_bind(user).push(" AND rb.organization_id=w.organization_id AND rp.resource_id=w.id AND rp.action='workspace.read' AND rp.allow)))");
    }
    if !filter.template.is_empty() {
        query
            .push(" AND lower(t.name)=")
            .push_bind(&filter.template);
    }
    if !filter.organization.is_empty() {
        query
            .push(" AND (lower(o.name)=")
            .push_bind(&filter.organization)
            .push(" OR o.id::text=")
            .push_bind(&filter.organization)
            .push(")");
    }
    if !filter.status.is_empty() {
        query.push(" AND b.status=").push_bind(&filter.status);
    }
    if let Some(outdated) = filter.outdated {
        query
            .push(" AND (b.template_version_id<>t.active_version_id)=")
            .push_bind(outdated);
    }
    if !filter.ids.is_empty() {
        query
            .push(" AND w.id=ANY(")
            .push_bind(&filter.ids)
            .push(")");
    }
    query
}

async fn named_workspace(
    app: &App,
    actor: &auth::User,
    user: &str,
    name: &str,
) -> Result<Workspace> {
    let user = if user == "me" {
        actor.username.as_str()
    } else {
        user
    };
    let id: Uuid = sqlx::query_scalar("SELECT w.id FROM coder_rust.workspaces w JOIN coder_rust.users u ON u.id=w.owner_id WHERE (lower(u.username)=lower($1) OR u.id::text=$1) AND lower(w.name)=lower($2) AND NOT w.deleted")
        .bind(user).bind(name).fetch_one(&app.pool).await?;
    authorized(app, actor, id).await
}

pub(crate) async fn by_name(
    State(app): State<App>,
    headers: HeaderMap,
    Path((user, name)): Path<(String, String)>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    let w = named_workspace(&app, &actor, &user, &name).await?;
    Ok(Json(
        w.json(&mut *app.pool.acquire().await?, actor.id).await?,
    ))
}

pub(crate) async fn build_by_number(
    State(app): State<App>,
    headers: HeaderMap,
    Path((user, name, number)): Path<(String, String, i32)>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    let w = named_workspace(&app, &actor, &user, &name).await?;
    let build = sqlx::query_as::<_, Build>(
        "SELECT * FROM coder_rust.builds WHERE workspace_id=$1 AND build_number=$2",
    )
    .bind(w.id)
    .bind(number)
    .fetch_one(&app.pool)
    .await?;
    Ok(Json(build.json()))
}

async fn authorized_build(app: &App, headers: &HeaderMap, id: Uuid) -> Result<Build> {
    let actor = auth::actor(app, headers).await?;
    let build = sqlx::query_as::<_, Build>("SELECT * FROM coder_rust.builds WHERE id=$1")
        .bind(id)
        .fetch_one(&app.pool)
        .await?;
    authorized(app, &actor, build.workspace_id).await?;
    Ok(build)
}

pub(crate) async fn get_build(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result {
    Ok(Json(authorized_build(&app, &headers, id).await?.json()))
}

pub(crate) async fn build_parameters(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result {
    Ok(Json(authorized_build(&app, &headers, id).await?.parameters))
}

pub(crate) async fn build_resources(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result {
    Ok(Json(authorized_build(&app, &headers, id).await?.resources))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CreateWorkspace {
    name: String,
    autostart_schedule: Option<String>,
    ttl_ms: Option<i64>,
    automatic_updates: Option<String>,
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
    let automatic_updates = req.automatic_updates.as_deref().unwrap_or("never");
    if !matches!(automatic_updates, "always" | "never") {
        return Err(Error::bad("Automatic updates must be always or never."));
    }
    let id = Uuid::new_v4();
    let build = Uuid::new_v4();
    let mut tx = app.pool.begin().await?;
    crate::quotas::lock_owner(&mut tx, owner).await?;
    let template = sqlx::query_as::<_, catalog::Template>(&format!(
        "{} WHERE t.id=$1 AND NOT t.deleted FOR SHARE OF t",
        catalog::TEMPLATE
    ))
    .bind(template.id)
    .fetch_one(&mut *tx)
    .await?;
    if !template.deprecation_message.is_empty() {
        return Err(Error::bad("This template is deprecated."));
    }
    let version = req
        .template_version_id
        .unwrap_or(template.active_version_id);
    if template.require_active_version && version != template.active_version_id {
        return Err(Error::bad("This template requires its active version."));
    }
    sqlx::query("SELECT id FROM coder_rust.template_versions WHERE id=$1 AND template_id=$2 AND NOT archived").bind(version).bind(template.id).fetch_one(&mut *tx).await?;
    let schedule = crate::schedules::prepare(
        &mut tx,
        owner,
        crate::schedules::Schedule {
            autostart_schedule: req.autostart_schedule,
            ttl_ms: req
                .ttl_ms
                .filter(|ms| *ms != 0)
                .or((template.default_ttl_ms > 0).then_some(template.default_ttl_ms)),
        },
        "create",
    )
    .await?;
    let params =
        catalog::validate_parameters(&mut tx, version, req.rich_parameter_values, None).await?;
    crate::quotas::enforce(&mut tx, owner, None, &params, None).await?;
    sqlx::query("INSERT INTO coder_rust.workspaces(id,organization_id,owner_id,template_id,name) VALUES($1,$2,$3,$4,$5)")
        .bind(id).bind(template.organization_id).bind(owner).bind(template.id).bind(req.name).execute(&mut *tx).await?;
    let next = schedule.next(chrono::Utc::now())?;
    sqlx::query("UPDATE coder_rust.workspaces SET autostart_schedule=$1,ttl_ms=$2,next_start_at=$3 WHERE id=$4")
        .bind(schedule.autostart_schedule).bind(schedule.ttl_ms).bind(next).bind(id).execute(&mut *tx).await?;
    sqlx::query("UPDATE coder_rust.workspaces SET automatic_updates=$1 WHERE id=$2")
        .bind(automatic_updates)
        .bind(id)
        .execute(&mut *tx)
        .await?;
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
    crate::schedules::on_build(conn, workspace, transition).await?;
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
    crate::quotas::lock_owner(&mut tx, w.owner_id).await?;
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
    let template = sqlx::query_as::<_, catalog::Template>(&format!(
        "{} WHERE t.id=$1 AND NOT t.deleted FOR SHARE OF t",
        catalog::TEMPLATE
    ))
    .bind(w.template_id)
    .fetch_one(&mut *tx)
    .await?;
    let version = if req.transition == "start" {
        req.template_version_id.unwrap_or(
            if template.require_active_version || w.automatic_updates == "always" {
                template.active_version_id
            } else {
                previous.template_version_id
            },
        )
    } else {
        previous.template_version_id
    };
    if req.transition == "start"
        && template.require_active_version
        && version != template.active_version_id
    {
        return Err(Error::bad("This template requires its active version."));
    }
    let belongs: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM coder_rust.template_versions WHERE id=$1 AND template_id=$2 AND (NOT archived OR $3))",
    )
    .bind(version)
    .bind(w.template_id)
    .bind(req.transition!="start")
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
            Some(previous.parameters.clone()),
        )
        .await?
    } else {
        previous.parameters.clone()
    };
    if req.transition == "start" {
        crate::quotas::enforce(
            &mut tx,
            w.owner_id,
            Some(id),
            &params,
            Some(&previous.parameters),
        )
        .await?;
    }
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

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AutoUpdates {
    automatic_updates: String,
}
pub(crate) async fn auto_updates(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<AutoUpdates>,
) -> Result<StatusCode> {
    let actor = auth::actor(&app, &headers).await?;
    let w = authorized_action(&app, &actor, id, "workspace.start").await?;
    if !matches!(req.automatic_updates.as_str(), "always" | "never") {
        return Err(Error::bad("Automatic updates must be always or never."));
    }
    let mut tx = app.pool.begin().await?;
    crate::quotas::lock_owner(&mut tx, w.owner_id).await?;
    sqlx::query(
        "UPDATE coder_rust.workspaces SET automatic_updates=$1 WHERE id=$2 AND NOT deleted",
    )
    .bind(req.automatic_updates)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    crate::rbac::audit(
        &mut tx,
        w.organization_id,
        actor.id,
        "workspace.autoupdates",
        Some(id),
    )
    .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
