use crate::{App, Error, Result, auth, catalog, rbac};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

#[derive(sqlx::FromRow)]
struct Version {
    id: Uuid,
    template_id: Uuid,
    organization_id: Uuid,
    name: String,
    message: String,
    archived: bool,
    created_at: chrono::DateTime<chrono::Utc>,
}
const VERSION: &str = "SELECT v.id,v.template_id,t.organization_id,v.name,v.message,v.archived,v.created_at FROM coder_rust.template_versions v JOIN coder_rust.templates t ON t.id=v.template_id";
impl Version {
    fn json(&self) -> Value {
        json!({"id":self.id,"template_id":self.template_id,"organization_id":self.organization_id,"name":self.name,"message":self.message,"archived":self.archived,"created_at":self.created_at,"updated_at":self.created_at})
    }
}

pub(crate) async fn authorized(
    app: &App,
    actor: &auth::User,
    id: Uuid,
    action: &str,
) -> Result<catalog::Template> {
    let t = sqlx::query_as::<_, catalog::Template>(&format!(
        "{} WHERE t.id=$1 AND NOT t.deleted",
        catalog::TEMPLATE
    ))
    .bind(id)
    .fetch_one(&app.pool)
    .await?;
    rbac::require(
        app,
        actor,
        t.organization_id,
        action,
        if action == "template.write" {
            None
        } else {
            Some(id)
        },
        action == "template.read",
    )
    .await?;
    Ok(t)
}
pub(crate) async fn list(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    authorized(&app, &actor, id, "template.read").await?;
    let rows = sqlx::query_as::<_, Version>(&format!(
        "{VERSION} WHERE v.template_id=$1 ORDER BY v.created_at DESC,v.id DESC LIMIT 1000"
    ))
    .bind(id)
    .fetch_all(&app.pool)
    .await?;
    Ok(Json(json!(
        rows.iter().map(Version::json).collect::<Vec<_>>()
    )))
}
pub(crate) async fn get(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    let v = sqlx::query_as::<_, Version>(&format!("{VERSION} WHERE v.id=$1"))
        .bind(id)
        .fetch_one(&app.pool)
        .await?;
    authorized(&app, &actor, v.template_id, "template.read").await?;
    Ok(Json(v.json()))
}
pub(crate) async fn by_name(
    State(app): State<App>,
    headers: HeaderMap,
    Path((id, name)): Path<(Uuid, String)>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    authorized(&app, &actor, id, "template.read").await?;
    let v = sqlx::query_as::<_, Version>(&format!(
        "{VERSION} WHERE v.template_id=$1 AND lower(v.name)=lower($2)"
    ))
    .bind(id)
    .bind(name)
    .fetch_one(&app.pool)
    .await?;
    Ok(Json(v.json()))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Create {
    template_id: Uuid,
    name: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    parameters: Vec<catalog::Parameter>,
    provisioner_spec: Value,
}
pub(crate) async fn create(
    State(app): State<App>,
    headers: HeaderMap,
    Path(org): Path<Uuid>,
    Json(req): Json<Create>,
) -> Result<(StatusCode, Json<Value>)> {
    let actor = auth::actor(&app, &headers).await?;
    let t = authorized(&app, &actor, req.template_id, "template.write").await?;
    if org != t.organization_id {
        return Err(Error::forbidden());
    }
    crate::name(&req.name)?;
    if req.message.len() > 16384 {
        return Err(Error::bad("Version message is too long."));
    }
    catalog::validate_schema(&req.parameters, &req.provisioner_spec)?;
    let mut tx = app.pool.begin().await?;
    sqlx::query("SELECT id FROM coder_rust.templates WHERE id=$1 AND NOT deleted FOR UPDATE")
        .bind(t.id)
        .fetch_one(&mut *tx)
        .await?;
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO coder_rust.template_versions(id,template_id,name,message,parameters,provisioner_spec) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(id).bind(t.id).bind(req.name).bind(req.message).bind(json!(req.parameters)).bind(req.provisioner_spec).execute(&mut *tx).await?;
    let v = sqlx::query_as::<_, Version>(&format!("{VERSION} WHERE v.id=$1"))
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    rbac::audit(&mut tx, org, actor.id, "template.version.create", Some(id)).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(v.json())))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Active {
    id: Uuid,
}
pub(crate) async fn activate(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<Active>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    let t = authorized(&app, &actor, id, "template.write").await?;
    let mut tx = app.pool.begin().await?;
    sqlx::query("SELECT id FROM coder_rust.templates WHERE id=$1 AND NOT deleted FOR UPDATE")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM coder_rust.template_versions WHERE id=$1 AND template_id=$2 AND NOT archived)").bind(req.id).bind(id).fetch_one(&mut *tx).await?;
    if !valid {
        return Err(Error::bad(
            "Select an unarchived version belonging to this template.",
        ));
    }
    sqlx::query("UPDATE coder_rust.templates SET active_version_id=$1 WHERE id=$2")
        .bind(req.id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    rbac::audit(
        &mut tx,
        t.organization_id,
        actor.id,
        "template.version.activate",
        Some(req.id),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"message":"Active template version updated."})))
}
async fn set_archived(app: App, headers: HeaderMap, id: Uuid, archived: bool) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    let v = sqlx::query_as::<_, Version>(&format!("{VERSION} WHERE v.id=$1"))
        .bind(id)
        .fetch_one(&app.pool)
        .await?;
    let t = authorized(&app, &actor, v.template_id, "template.write").await?;
    let mut tx = app.pool.begin().await?;
    let active: Uuid = sqlx::query_scalar(
        "SELECT active_version_id FROM coder_rust.templates WHERE id=$1 AND NOT deleted FOR UPDATE",
    )
    .bind(t.id)
    .fetch_one(&mut *tx)
    .await?;
    if archived && active == id {
        return Err(Error::conflict(
            "The active template version cannot be archived.",
        ));
    }
    if archived {
        let used:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM coder_rust.workspaces w JOIN coder_rust.builds b ON b.id=w.latest_build_id WHERE NOT w.deleted AND b.template_version_id=$1)").bind(id).fetch_one(&mut *tx).await?;
        if used {
            return Err(Error::conflict(
                "This version is still in use by a workspace.",
            ));
        }
    }
    sqlx::query("UPDATE coder_rust.template_versions SET archived=$1 WHERE id=$2")
        .bind(archived)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    rbac::audit(
        &mut tx,
        t.organization_id,
        actor.id,
        if archived {
            "template.version.archive"
        } else {
            "template.version.unarchive"
        },
        Some(id),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"archived":archived})))
}
pub(crate) async fn archive(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result {
    set_archived(app, headers, id, true).await
}
pub(crate) async fn unarchive(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result {
    set_archived(app, headers, id, false).await
}
pub(crate) async fn source(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    let (template,parameters,spec):(Uuid,Value,Value)=sqlx::query_as("SELECT template_id,parameters,provisioner_spec FROM coder_rust.template_versions WHERE id=$1").bind(id).fetch_one(&app.pool).await?;
    authorized(&app, &actor, template, "template.write").await?;
    Ok(Json(
        json!({"parameters":parameters,"provisioner_spec":spec}),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Metadata {
    name: Option<String>,
    display_name: Option<String>,
    description: Option<String>,
    icon: Option<String>,
    deprecation_message: Option<String>,
    default_ttl_ms: Option<i64>,
    require_active_version: Option<bool>,
}
pub(crate) async fn update(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<Metadata>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    let t = authorized(&app, &actor, id, "template.write").await?;
    if let Some(name) = &req.name {
        crate::name(name)?;
    }
    if req.display_name.as_ref().is_some_and(|v| v.len() > 64)
        || req.description.as_ref().is_some_and(|v| v.len() > 16384)
        || req.icon.as_ref().is_some_and(|v| v.len() > 2048)
        || req
            .deprecation_message
            .as_ref()
            .is_some_and(|v| v.len() > 16384)
        || req
            .default_ttl_ms
            .is_some_and(|v| v != 0 && !(60000..=2592000000).contains(&v))
    {
        return Err(Error::bad(
            "Invalid template metadata or default autostop duration.",
        ));
    }
    let mut tx = app.pool.begin().await?;
    let changed = sqlx::query("UPDATE coder_rust.templates SET name=COALESCE($2,name),display_name=COALESCE($3,display_name),description=COALESCE($4,description),icon=COALESCE($5,icon),deprecation_message=COALESCE($6,deprecation_message),default_ttl_ms=COALESCE($7,default_ttl_ms),require_active_version=COALESCE($8,require_active_version) WHERE id=$1 AND NOT deleted")
        .bind(id).bind(req.name).bind(req.display_name).bind(req.description).bind(req.icon).bind(req.deprecation_message).bind(req.default_ttl_ms).bind(req.require_active_version).execute(&mut *tx).await?.rows_affected();
    if changed == 0 {
        return Err(sqlx::Error::RowNotFound.into());
    }
    let row =
        sqlx::query_as::<_, catalog::Template>(&format!("{} WHERE t.id=$1", catalog::TEMPLATE))
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    rbac::audit(
        &mut tx,
        t.organization_id,
        actor.id,
        "template.update",
        Some(id),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(row.json()))
}
pub(crate) async fn delete(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    let t = authorized(&app, &actor, id, "template.write").await?;
    let mut tx = app.pool.begin().await?;
    sqlx::query("SELECT id FROM coder_rust.templates WHERE id=$1 AND NOT deleted FOR UPDATE")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    let used: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM coder_rust.workspaces WHERE template_id=$1 AND NOT deleted)",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    if used {
        return Err(Error::conflict(
            "Delete this template's workspaces before deleting the template.",
        ));
    }
    sqlx::query("UPDATE coder_rust.templates SET deleted=true WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    rbac::audit(
        &mut tx,
        t.organization_id,
        actor.id,
        "template.delete",
        Some(id),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"message":"Template deleted."})))
}
