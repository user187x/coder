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
    pub icon: String,
    pub deprecation_message: String,
    pub default_ttl_ms: i64,
    pub require_active_version: bool,
}
pub(crate) const TEMPLATE: &str = "SELECT t.*,o.name AS organization_name FROM coder_rust.templates t JOIN coder_rust.organizations o ON o.id=t.organization_id";
impl Template {
    pub fn json(&self) -> Value {
        json!({"id":self.id,"organization_id":self.organization_id,"organization_name":self.organization_name,"name":self.name,
        "display_name":self.display_name,"description":self.description,"active_version_id":self.active_version_id,"deprecated":!self.deprecation_message.is_empty(),"deprecation_message":self.deprecation_message,"icon":self.icon,"default_ttl_ms":self.default_ttl_ms,"require_active_version":self.require_active_version})
    }
}
pub(crate) async fn templates(State(app): State<App>, headers: HeaderMap) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    let rows=sqlx::query_as::<_,Template>(&format!("{TEMPLATE} JOIN coder_rust.memberships m ON m.organization_id=t.organization_id WHERE NOT t.deleted AND m.user_id=$1 AND coder_rust.permitted($1,t.organization_id,'template.read',t.id,true) ORDER BY t.name"))
        .bind(actor.id).fetch_all(&app.pool).await?;
    let mut values = Vec::new();
    let mut conn = app.pool.acquire().await?;
    for row in rows {
        values.push(template_json(&mut conn, &row, actor.id).await?);
    }
    Ok(Json(json!(values)))
}
pub(crate) async fn template(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    let row = sqlx::query_as::<_, Template>(&format!("{TEMPLATE} WHERE t.id=$1 AND NOT t.deleted"))
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
    Ok(Json(
        template_json(&mut *app.pool.acquire().await?, &row, actor.id).await?,
    ))
}
pub(crate) async fn parameters(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    let (org,template,params):(Uuid,Uuid,Value)=sqlx::query_as("SELECT t.organization_id,t.id,v.parameters FROM coder_rust.template_versions v JOIN coder_rust.templates t ON t.id=v.template_id WHERE v.id=$1 AND NOT t.deleted")
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
    let rows:Vec<(Uuid,String,String,bool)>=sqlx::query_as("SELECT o.id,o.name,o.display_name,coder_rust.permitted($2,o.id,'template.write',NULL,false) FROM coder_rust.organizations o JOIN coder_rust.memberships m ON m.organization_id=o.id WHERE m.user_id=$1 ORDER BY o.name")
        .bind(id).bind(actor.id).fetch_all(&app.pool).await?;
    Ok(Json(json!(rows.into_iter().map(|(id,name,display_name,template_write)|json!({"id":id,"name":name,"display_name":display_name,"template_write":template_write})).collect::<Vec<_>>())))
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
    if req.display_name.len() > 64 || req.description.len() > 16384 {
        return Err(Error::bad(
            "Invalid template metadata, parameters, or provisioner specification.",
        ));
    }
    validate_schema(&req.parameters, &req.provisioner_spec)?;
    let id = Uuid::new_v4();
    let version = Uuid::new_v4();
    let mut tx = app.pool.begin().await?;
    sqlx::query("INSERT INTO coder_rust.templates(id,organization_id,name,display_name,description,active_version_id) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(id).bind(org).bind(req.name).bind(req.display_name).bind(req.description).bind(version).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO coder_rust.template_versions(id,template_id,parameters,provisioner_spec,name) VALUES($1,$2,$3,$4,'v1')")
        .bind(version).bind(id).bind(json!(req.parameters)).bind(req.provisioner_spec).execute(&mut *tx).await?;
    let row = sqlx::query_as::<_, Template>(&format!("{TEMPLATE} WHERE t.id=$1 AND NOT t.deleted"))
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    crate::rbac::audit(&mut tx, org, actor.id, "template.create", Some(id)).await?;
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
    let previous: Vec<ParameterValue> = previous
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    let mut supplied: std::collections::HashMap<String, String> = previous
        .into_iter()
        .filter(|p| schema.iter().any(|field| field.name == p.name))
        .map(|p| (p.name, p.value))
        .collect();
    let mut seen = std::collections::HashSet::new();
    for item in values.unwrap_or_default() {
        if !seen.insert(item.name.clone()) {
            return Err(Error::bad("Duplicate parameter name."));
        }
        supplied.insert(item.name, item.value);
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

pub(crate) fn validate_schema(parameters: &[Parameter], spec: &Value) -> Result<()> {
    if parameters.len() > 100
        || !spec.is_object()
        || spec["driver"].as_str().is_none_or(|v| v.is_empty())
    {
        return Err(Error::bad(
            "Provide a provisioner driver and at most 100 parameters.",
        ));
    }
    let mut names = std::collections::HashSet::new();
    for param in parameters {
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
    if spec["driver"] == "terraform" {
        let files = spec["files"]
            .as_object()
            .ok_or_else(|| Error::bad("Terraform templates require source files."))?;
        if files.is_empty() || files.len() > 32 {
            return Err(Error::bad("Provide between 1 and 32 Terraform files."));
        }
        let mut size = 0;
        for (name, content) in files {
            if name.contains('/')
                || name.contains('\\')
                || !(name.ends_with(".tf")
                    || name.ends_with(".tf.json")
                    || name == ".terraform.lock.hcl")
            {
                return Err(Error::bad("Use flat Terraform filenames."));
            }
            size += content
                .as_str()
                .ok_or_else(|| Error::bad("Terraform source must be text."))?
                .len();
        }
        if size > 65536 {
            return Err(Error::bad("Terraform source must total at most 64 KiB."));
        }
    }
    Ok(())
}

async fn template_json(conn: &mut PgConnection, t: &Template, actor: Uuid) -> Result<Value> {
    let allowed: bool =
        sqlx::query_scalar("SELECT coder_rust.permitted($1,$2,'template.write',NULL,false)")
            .bind(actor)
            .bind(t.organization_id)
            .fetch_one(conn)
            .await?;
    let mut value = t.json();
    value["can_manage"] = json!(allowed);
    Ok(value)
}
