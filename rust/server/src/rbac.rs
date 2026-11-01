//! Organization-scoped, deny-first authorization shared by APIs and SQL listings.

use crate::{App, Error, Result, auth};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

pub(crate) const ACTIONS: &[&str] = &[
    "workspace.read",
    "workspace.create",
    "workspace.start",
    "workspace.stop",
    "workspace.cancel",
    "workspace.delete",
    "workspace.connect",
    "workspace.terminal",
    "workspace.agent",
    "workspace.state.read",
    "workspace.state.recover",
    "template.read",
    "template.use",
    "template.write",
    "provisioner.manage",
    "rbac.manage",
    "audit.read",
];

pub(crate) async fn require(
    app: &App,
    actor: &auth::User,
    org: Uuid,
    action: &str,
    resource: Option<Uuid>,
    baseline: bool,
) -> Result<()> {
    let allowed: bool = sqlx::query_scalar("SELECT coder_rust.permitted($1,$2,$3,$4,$5)")
        .bind(actor.id)
        .bind(org)
        .bind(action)
        .bind(resource)
        .bind(baseline)
        .fetch_one(&app.pool)
        .await?;
    if allowed {
        Ok(())
    } else {
        Err(Error::forbidden())
    }
}

pub(crate) async fn audit(
    conn: &mut sqlx::PgConnection,
    org: Uuid,
    actor: Uuid,
    action: &str,
    resource: Option<Uuid>,
) -> Result<()> {
    audit_details(conn, org, actor, action, resource, json!({})).await
}
async fn audit_details(
    conn: &mut sqlx::PgConnection,
    org: Uuid,
    actor: Uuid,
    action: &str,
    resource: Option<Uuid>,
    details: serde_json::Value,
) -> Result<()> {
    sqlx::query("INSERT INTO coder_rust.audit_events(organization_id,actor_id,action,resource_id,details) VALUES($1,$2,$3,$4,$5)")
        .bind(org).bind(actor).bind(action).bind(resource).bind(details).execute(conn).await?;
    Ok(())
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Permission {
    action: String,
    resource_id: Option<Uuid>,
    allow: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Role {
    name: String,
    permissions: Vec<Permission>,
}

/// @Router /organizations/{org}/roles [get]
pub(crate) async fn list(
    State(app): State<App>,
    headers: HeaderMap,
    Path(org): Path<Uuid>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    require(&app, &actor, org, "rbac.manage", None, false).await?;
    let rows:Vec<(Uuid,String,serde_json::Value)> = sqlx::query_as("SELECT r.id,r.name,COALESCE((SELECT jsonb_agg(jsonb_build_object('action',p.action,'resource_id',p.resource_id,'allow',p.allow)) FROM coder_rust.role_permissions p WHERE p.organization_id=r.organization_id AND p.role_id=r.id),'[]'::jsonb) FROM coder_rust.roles r WHERE r.organization_id=$1 ORDER BY r.name")
        .bind(org).fetch_all(&app.pool).await?;
    let bindings:Vec<(Uuid,Uuid)>=sqlx::query_as("SELECT role_id,user_id FROM coder_rust.role_bindings WHERE organization_id=$1 ORDER BY role_id,user_id").bind(org).fetch_all(&app.pool).await?;
    Ok(Json(
        json!({"actions":ACTIONS,"roles":rows.into_iter().map(|(id,name,permissions)|json!({"id":id,"name":name,"permissions":permissions})).collect::<Vec<_>>(),"bindings":bindings.into_iter().map(|(role_id,user_id)|json!({"role_id":role_id,"user_id":user_id})).collect::<Vec<_>>()}),
    ))
}

/// @Router /organizations/{org}/roles/{id} [put]
pub(crate) async fn put(
    State(app): State<App>,
    headers: HeaderMap,
    Path((org, id)): Path<(Uuid, Uuid)>,
    Json(req): Json<Role>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    require(&app, &actor, org, "rbac.manage", None, false).await?;
    crate::name(&req.name)?;
    if req.permissions.len() > 128
        || req
            .permissions
            .iter()
            .any(|p| !ACTIONS.contains(&p.action.as_str()))
    {
        return Err(Error::bad(
            "Use at most 128 permissions with recognized action names.",
        ));
    }
    let mut tx = app.pool.begin().await?;
    // Serialize replacements of a role so readers never observe partial permissions.
    sqlx::query("INSERT INTO coder_rust.roles(organization_id,id,name) VALUES($1,$2,$3) ON CONFLICT(organization_id,id) DO UPDATE SET name=EXCLUDED.name")
        .bind(org).bind(id).bind(&req.name).execute(&mut *tx).await?;
    for p in &req.permissions {
        if let Some(resource) = p.resource_id {
            let query = if p.action.starts_with("workspace.") && p.action != "workspace.create" {
                "SELECT EXISTS(SELECT 1 FROM coder_rust.workspaces WHERE organization_id=$1 AND id=$2 AND NOT deleted)"
            } else if matches!(p.action.as_str(), "template.read" | "template.use") {
                "SELECT EXISTS(SELECT 1 FROM coder_rust.templates WHERE organization_id=$1 AND id=$2)"
            } else {
                return Err(Error::bad(
                    "This action requires an organization-wide resource scope.",
                ));
            };
            if !sqlx::query_scalar::<_, bool>(query)
                .bind(org)
                .bind(resource)
                .fetch_one(&mut *tx)
                .await?
            {
                return Err(Error::bad(
                    "Permission resource does not belong to this organization.",
                ));
            }
        }
    }
    sqlx::query("DELETE FROM coder_rust.role_permissions WHERE organization_id=$1 AND role_id=$2")
        .bind(org)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    for p in &req.permissions {
        sqlx::query("INSERT INTO coder_rust.role_permissions VALUES($1,$2,$3,$4,$5)")
            .bind(org)
            .bind(id)
            .bind(&p.action)
            .bind(p.resource_id)
            .bind(p.allow)
            .execute(&mut *tx)
            .await?;
    }
    audit_details(
        &mut tx,
        org,
        actor.id,
        "role.write",
        Some(id),
        json!({"name":req.name,"permissions":req.permissions}),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"id":id})))
}

/// @Router /organizations/{org}/roles/{id} [delete]
pub(crate) async fn delete(
    State(app): State<App>,
    headers: HeaderMap,
    Path((org, id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode> {
    let actor = auth::actor(&app, &headers).await?;
    require(&app, &actor, org, "rbac.manage", None, false).await?;
    let mut tx = app.pool.begin().await?;
    sqlx::query("DELETE FROM coder_rust.roles WHERE organization_id=$1 AND id=$2")
        .bind(org)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    audit(&mut tx, org, actor.id, "role.delete", Some(id)).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn bind(
    State(app): State<App>,
    headers: HeaderMap,
    Path(ids): Path<(Uuid, Uuid, Uuid)>,
) -> Result<StatusCode> {
    binding(app, headers, ids, true).await
}
pub(crate) async fn unbind(
    State(app): State<App>,
    headers: HeaderMap,
    Path(ids): Path<(Uuid, Uuid, Uuid)>,
) -> Result<StatusCode> {
    binding(app, headers, ids, false).await
}
async fn binding(
    app: App,
    headers: HeaderMap,
    (org, role, user): (Uuid, Uuid, Uuid),
    add: bool,
) -> Result<StatusCode> {
    let actor = auth::actor(&app, &headers).await?;
    require(&app, &actor, org, "rbac.manage", None, false).await?;
    crate::member(&app, user, org).await?;
    let mut tx = app.pool.begin().await?;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM coder_rust.roles WHERE organization_id=$1 AND id=$2)",
    )
    .bind(org)
    .bind(role)
    .fetch_one(&mut *tx)
    .await?;
    if !exists {
        return Err(Error::bad("Role does not belong to this organization."));
    }
    let query = if add {
        "INSERT INTO coder_rust.role_bindings VALUES($1,$2,$3) ON CONFLICT DO NOTHING"
    } else {
        "DELETE FROM coder_rust.role_bindings WHERE organization_id=$1 AND role_id=$2 AND user_id=$3"
    };
    sqlx::query(query)
        .bind(org)
        .bind(role)
        .bind(user)
        .execute(&mut *tx)
        .await?;
    audit_details(
        &mut tx,
        org,
        actor.id,
        if add { "role.bind" } else { "role.unbind" },
        Some(user),
        json!({"role_id":role}),
    )
    .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// @Router /organizations/{org}/audit [get]
pub(crate) async fn events(
    State(app): State<App>,
    headers: HeaderMap,
    Path(org): Path<Uuid>,
    Query(page): Query<auth::Search>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    require(&app, &actor, org, "audit.read", None, false).await?;
    let (offset, limit) = page.page()?;
    let rows:Vec<serde_json::Value>=sqlx::query_scalar("SELECT to_jsonb(e) FROM coder_rust.audit_events e WHERE organization_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3").bind(org).bind(limit).bind(offset).fetch_all(&app.pool).await?;
    Ok(Json(json!(rows)))
}

/// @Router /organizations/{org}/roles [post]
pub(crate) async fn create(
    State(app): State<App>,
    headers: HeaderMap,
    Path(org): Path<Uuid>,
    req: Json<Role>,
) -> Result {
    put(State(app), headers, Path((org, Uuid::new_v4())), req).await
}
/// @Router /organizations/{org}/members [get]
pub(crate) async fn members(
    State(app): State<App>,
    headers: HeaderMap,
    Path(org): Path<Uuid>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    require(&app, &actor, org, "rbac.manage", None, false).await?;
    let rows:Vec<(Uuid,String)>=sqlx::query_as("SELECT u.id,u.username FROM coder_rust.users u JOIN coder_rust.memberships m ON m.user_id=u.id WHERE m.organization_id=$1 ORDER BY u.username LIMIT 1000").bind(org).fetch_all(&app.pool).await?;
    Ok(Json(json!(
        rows.into_iter()
            .map(|(id, username)| json!({"id":id,"username":username}))
            .collect::<Vec<_>>()
    )))
}
