use crate::{App, Error, Result, auth};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{FromRow, PgConnection};
use uuid::Uuid;

#[derive(FromRow)]
pub(crate) struct Template {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub organization_name: String,
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub active_version_id: Uuid,
}
pub(crate) const TEMPLATE: &str = "SELECT t.*,o.name AS organization_name FROM coder_rust.templates t JOIN coder_rust.organizations o ON o.id=t.organization_id";
impl Template {
    pub fn json(&self) -> Value {
        json!({"id":self.id,"organization_id":self.organization_id,"organization_name":self.organization_name,"name":self.name,
        "display_name":self.display_name,"description":self.description,"active_version_id":self.active_version_id,"deprecated":false,"deprecation_message":""})
    }
}
pub(crate) async fn templates(State(app): State<App>, headers: HeaderMap) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    let rows=sqlx::query_as::<_,Template>(&format!("{TEMPLATE} JOIN coder_rust.memberships m ON m.organization_id=t.organization_id WHERE m.user_id=$1 AND coder_rust.permitted($1,t.organization_id,'template.read',t.id,true) ORDER BY t.name"))
        .bind(actor.id).fetch_all(&app.pool).await?;
    Ok(Json(json!(
        rows.iter().map(Template::json).collect::<Vec<_>>()
    )))
}
pub(crate) async fn template(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    let row = sqlx::query_as::<_, Template>(&format!("{TEMPLATE} WHERE t.id=$1"))
        .bind(id)
        .fetch_one(&app.pool)
        .await?;
    crate::rbac::require(
        &app,
        &actor,
        row.organization_id,
        "template.read",
        Some(row.id),
        true,
    )
    .await?;
    Ok(Json(row.json()))
}
pub(crate) async fn parameters(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    let (org,template,params):(Uuid,Uuid,Value)=sqlx::query_as("SELECT t.organization_id,t.id,v.parameters FROM coder_rust.template_versions v JOIN coder_rust.templates t ON t.id=v.template_id WHERE v.id=$1")
        .bind(id).fetch_one(&app.pool).await?;
    crate::rbac::require(&app, &actor, org, "template.read", Some(template), true).await?;
    Ok(Json(params))
}
pub(crate) async fn organizations(
    State(app): State<App>,
    headers: HeaderMap,
    Path(user): Path<String>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    let id = crate::target(&actor, &user)?;
    let rows:Vec<(Uuid,String,String)>=sqlx::query_as("SELECT o.id,o.name,o.display_name FROM coder_rust.organizations o JOIN coder_rust.memberships m ON m.organization_id=o.id WHERE m.user_id=$1 ORDER BY o.name")
        .bind(id).fetch_all(&app.pool).await?;
    Ok(Json(json!(
        rows.into_iter()
            .map(
                |(id, name, display_name)| json!({"id":id,"name":name,"display_name":display_name})
            )
            .collect::<Vec<_>>()
    )))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CreateTemplate {
    name: String,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    parameters: Vec<Parameter>,
    provisioner_spec: Value,
}
#[derive(Deserialize, serde::Serialize, Clone)]
#[serde(deny_unknown_fields)]
pub(crate) struct Parameter {
    pub name: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub description_plaintext: String,
    pub r#type: String,
    #[serde(default)]
    pub default_value: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub options: Vec<ParameterOption>,
}
#[derive(Deserialize, serde::Serialize, Clone)]
#[serde(deny_unknown_fields)]
pub(crate) struct ParameterOption {
    pub name: String,
    pub value: String,
}

pub(crate) async fn create_template(
    State(app): State<App>,
    headers: HeaderMap,
    Path(org): Path<Uuid>,
    Json(req): Json<CreateTemplate>,
) -> Result<(StatusCode, Json<Value>)> {
    let actor = auth::actor(&app, &headers).await?;
    crate::rbac::require(&app, &actor, org, "template.write", None, false).await?;
    crate::name(&req.name)?;
    if req.display_name.len() > 64
        || req.description.len() > 16384
        || req.parameters.len() > 100
        || !req.provisioner_spec.is_object()
    {
        return Err(Error::bad(
            "Invalid template metadata, parameters, or provisioner specification.",
        ));
    }
    let mut names = std::collections::HashSet::new();
    for param in &req.parameters {
        if param.name.is_empty()
            || param.name.len() > 128
            || !names.insert(&param.name)
            || !matches!(
                param.r#type.as_str(),
                "string" | "bool" | "number" | "list(string)"
            )
            || param.options.len() > 100
        {
            return Err(Error::bad(
                "Parameters require unique names and supported types.",
            ));
        }
    }
    let id = Uuid::new_v4();
    let version = Uuid::new_v4();
    let mut tx = app.pool.begin().await?;
    sqlx::query("INSERT INTO coder_rust.templates(id,organization_id,name,display_name,description,active_version_id) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(id).bind(org).bind(req.name).bind(req.display_name).bind(req.description).bind(version).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO coder_rust.template_versions(id,template_id,parameters,provisioner_spec) VALUES($1,$2,$3,$4)")
        .bind(version).bind(id).bind(json!(req.parameters)).bind(req.provisioner_spec).execute(&mut *tx).await?;
    let row = sqlx::query_as::<_, Template>(&format!("{TEMPLATE} WHERE t.id=$1"))
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(row.json())))
}

#[derive(Deserialize, serde::Serialize, Clone)]
#[serde(deny_unknown_fields)]
pub(crate) struct ParameterValue {
    pub name: String,
    pub value: String,
}

pub(crate) async fn validate_parameters(
    conn: &mut PgConnection,
    version: Uuid,
    values: Option<Vec<ParameterValue>>,
    previous: Option<Value>,
) -> Result<Value> {
    let schema: Value =
        sqlx::query_scalar("SELECT parameters FROM coder_rust.template_versions WHERE id=$1")
            .bind(version)
            .fetch_one(&mut *conn)
            .await?;
    let schema: Vec<Parameter> = serde_json::from_value(schema)
        .map_err(|_| Error::bad("Invalid template parameter schema."))?;
    let values = values.unwrap_or_else(|| {
        previous
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default()
    });
    let mut supplied = std::collections::HashMap::new();
    for item in values {
        if supplied.insert(item.name, item.value).is_some() {
            return Err(Error::bad("Duplicate parameter name."));
        }
    }
    if supplied
        .keys()
        .any(|n| !schema.iter().any(|p| p.name == *n))
    {
        return Err(Error::bad("Unknown template parameter."));
    }
    let mut output = Vec::new();
    for p in schema {
        let value = supplied.remove(&p.name).unwrap_or(p.default_value);
        if (p.required && value.is_empty()) || value.len() > 16384 {
            return Err(Error::bad(format!("Invalid value for {}.", p.name)));
        }
        if !p.options.is_empty() && !p.options.iter().any(|o| o.value == value) {
            return Err(Error::bad(format!("Unknown option for {}.", p.name)));
        }
        let valid = match p.r#type.as_str() {
            "number" => value.parse::<f64>().is_ok_and(f64::is_finite),
            "bool" => matches!(value.as_str(), "true" | "false"),
            "list(string)" => serde_json::from_str::<Vec<String>>(&value).is_ok(),
            _ => true,
        };
        if !valid {
            return Err(Error::bad(format!(
                "Incorrect parameter type for {}.",
                p.name
            )));
        }
        output.push(ParameterValue {
            name: p.name,
            value,
        });
    }
    Ok(json!(output))
}
