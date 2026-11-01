use crate::{
    api::{Api, UiError},
    models::{Template, User},
    views,
};
use axum::{
    Form,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Redirect, Response},
};
use maud::{Markup, html};
use reqwest::Method;
use serde_json::{Value, json};
use std::collections::HashMap;
type Result<T = Response> = std::result::Result<T, UiError>;
fn field<'a>(v: &'a HashMap<String, String>, key: &str) -> &'a str {
    v.get(key).map(String::as_str).unwrap_or_default()
}
fn parse(v: &HashMap<String, String>, key: &str) -> Result<Value> {
    serde_json::from_str(field(v, key))
        .map_err(|_| UiError::bad_request(format!("{key} must contain valid JSON.")))
}
const EXAMPLE: &str = "{\n  \"main.tf\": \"terraform { required_version = \\\">= 1.4\\\" }\\nvariable \\\"coder_start_count\\\" { type = number }\\nresource \\\"terraform_data\\\" \\\"workspace\\\" { count = var.coder_start_count }\\n\"\n}";

fn source_fields(files: &str, parameters: &str) -> Markup {
    html! {
        label for="files" {"Terraform files"} textarea.code-input id="files" name="files" rows="15" required {(files)}
        p.hint {"A JSON object mapping filenames to Terraform source. Use flat .tf or .tf.json files, with an optional .terraform.lock.hcl, totaling at most 64 KiB. The selected Terraform or OpenTofu engine runs these files."}
        label for="parameters" {"Workspace parameter definitions"} textarea.code-input id="parameters" name="parameters" rows="8" required {(parameters)}
        p.hint {"A JSON array of named parameters: name, type, default_value, required, and optional choices. Types: string, number, bool, list(string)."}
    }
}
async fn create_page(
    api: &Api,
    headers: &HeaderMap,
    values: &HashMap<String, String>,
    message: Option<&str>,
) -> Result {
    let user: User = api.get(headers, &["users", "me"], &[]).await?;
    let orgs: Vec<Value> = api.list(headers, &["users", "me", "organizations"]).await?;
    let allowed: Vec<_> = orgs
        .iter()
        .filter(|o| o["template_write"] == true)
        .collect();
    if allowed.is_empty() {
        return Err(UiError::new(
            StatusCode::FORBIDDEN,
            "You need template management permission in an organization.",
        ));
    }
    Ok(crate::html(views::page(
        "Create template",
        Some(&user),
        Some(api),
        html! {
            section.form-page {a.back href="/templates" {"Back to templates"} h1 {"Create template"}
                @if let Some(message)=message {div.alert role="alert" {(message)}}
                form.stack method="post" action="/templates/new" {
                    label for="organization" {"Organization"} select id="organization" name="organization" required {
                        @for o in allowed {option value=(o["id"].as_str().unwrap_or_default()) selected[field(values,"organization")==o["id"].as_str().unwrap_or_default()] {(o["display_name"].as_str().unwrap_or_default())}}
                    }
                    @for (key,label) in [("name","Name"),("display_name","Display name"),("description","Description")] {
                        label for=(key) {(label)} input id=(key) name=(key) value=(field(values,key)) required[key=="name"];
                    }
                    (source_fields(values.get("files").map(String::as_str).unwrap_or(EXAMPLE),values.get("parameters").map(String::as_str).unwrap_or("[]")))
                    button.primary type="submit" {"Create template"}
                }
            }
        },
    )))
}
pub(crate) async fn new(State(api): State<Api>, headers: HeaderMap) -> Result {
    create_page(&api, &headers, &HashMap::new(), None).await
}
pub(crate) async fn create(
    State(api): State<Api>,
    headers: HeaderMap,
    Form(values): Form<HashMap<String, String>>,
) -> Result {
    let files = parse(&values, "files")?;
    let parameters = parse(&values, "parameters")?;
    let result:Result<Template>=api.send(&headers,Method::POST,&["organizations",field(&values,"organization"),"templates"],&json!({"name":field(&values,"name"),"display_name":field(&values,"display_name"),"description":field(&values,"description"),"parameters":parameters,"provisioner_spec":{"driver":"terraform","files":files}})).await;
    match result {
        Ok(t) => Ok(
            Redirect::to(&format!("/templates/{}/settings", views::segment(&t.id))).into_response(),
        ),
        Err(error) => Ok((
            error.status,
            create_page(&api, &headers, &values, Some(&error.message)).await?,
        )
            .into_response()),
    }
}

async fn settings_page(api: &Api, headers: &HeaderMap, id: &str, message: Option<&str>) -> Result {
    let user: User = api.get(headers, &["users", "me"], &[]).await?;
    let t: Template = api.get(headers, &["templates", id], &[]).await?;
    let source: Value = api
        .get(
            headers,
            &["templateversions", &t.active_version_id, "source"],
            &[],
        )
        .await?;
    let versions: Vec<Value> = api.list(headers, &["templates", id, "versions"]).await?;
    let action = format!("/templates/{}/settings", views::segment(id));
    Ok(crate::html(views::page(
        "Template settings",
        Some(&user),
        Some(api),
        html! {
            a.back href=(format!("/templates/{}",views::segment(id))) {"Back to template"} h1 {(t.title()) " settings"}
            @if let Some(message)=message {div.alert role="alert" {(message)}}
            section.panel.form-page {h2 {"General"} form.stack method="post" action=(&action) {
                input type="hidden" name="action" value="metadata";
                @for (key,label,value) in [("name","Name",t.name.as_str()),("display_name","Display name",t.display_name.as_str()),("description","Description",t.description.as_str()),("deprecation_message","Deprecation message",t.deprecation_message.as_str())] {
                    label for=(key) {(label)} input id=(key) name=(key) value=(value) required[key=="name"];
                }
                p.hint {"A deprecation message prevents creation of new workspaces. Existing workspaces can still be managed."}
                label for="default_ttl" {"Default automatic stop (minutes)"} input id="default_ttl" name="default_ttl_minutes" type="number" min="0" max="43200" value=(t.default_ttl_ms/60000);
                label.check {input type="checkbox" name="require_active_version" value="yes" checked[t.require_active_version]; "Require the active version on every start"}
                button.primary type="submit" {"Save template settings"}
            }}
            section.panel {h2 {"Versions"} div.table-wrap {table {thead {tr {th {"Name"} th {"Message"} th {"Status"} th {"Actions"}}}
                tbody {@for v in &versions {tr {
                    td {(v["name"].as_str().unwrap_or_default())} td {(v["message"].as_str().unwrap_or_default())}
                    td {@if v["id"]==t.active_version_id {"Active"} @else if v["archived"]==true {"Archived"} @else {"Available"}}
                    td {div.actions {@if v["id"]!=t.active_version_id {
                        @for (command,label) in if v["archived"]==true {vec![("unarchive","Unarchive")]} else {vec![("activate","Make active"),("archive","Archive")]} {
                            form method="post" action=(&action) {input type="hidden" name="action" value=(command);input type="hidden" name="version" value=(v["id"].as_str().unwrap_or_default());button type="submit" {(label)}}
                        }
                    }}}
                }}}
            }}}
            @if source["provisioner_spec"]["driver"]=="terraform" {
                section.panel.form-page {h2 {"Publish version"} form.stack method="post" action=(&action) {
                    input type="hidden" name="action" value="publish";input type="hidden" name="base_version" value=(&t.active_version_id);
                    label for="version_name" {"Version name"} input id="version_name" name="version_name" required maxlength="32";
                    label for="version_message" {"Message"} input id="version_message" name="message";
                    (source_fields(&serde_json::to_string_pretty(&source["provisioner_spec"]["files"]).unwrap_or_default(),&serde_json::to_string_pretty(&source["parameters"]).unwrap_or_default()))
                    p.hint {"Publishing preserves the active version until you select Make active. The worker validates Terraform when a workspace build runs."}
                    button.primary type="submit" {"Publish version"}
                }}
            }
            details.danger {summary {"Delete template"} form.stack method="post" action=(&action) {
                input type="hidden" name="action" value="delete";
                label for="confirm_template" {"Type " (t.name) " to delete this template. It must have no remaining workspaces."}
                input id="confirm_template" name="confirm" required;
                button.destructive type="submit" {"Delete template"}
            }}
        },
    )))
}
pub(crate) async fn settings(
    State(api): State<Api>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result {
    settings_page(&api, &headers, &id, None).await
}
pub(crate) async fn save(
    State(api): State<Api>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Form(values): Form<HashMap<String, String>>,
) -> Result {
    let t: Template = api.get(&headers, &["templates", &id], &[]).await?;
    let command = field(&values, "action");
    let result: Result<Value> = match command {
        "metadata" => {
            let minutes = field(&values, "default_ttl_minutes")
                .parse::<i64>()
                .map_err(|_| UiError::bad_request("Enter the default stop duration in minutes."))?;
            let ms = minutes
                .checked_mul(60000)
                .ok_or_else(|| UiError::bad_request("Stop duration is too large."))?;
            api.send(&headers,Method::PATCH,&["templates",&id],&json!({"name":field(&values,"name"),"display_name":field(&values,"display_name"),"description":field(&values,"description"),"deprecation_message":field(&values,"deprecation_message"),"default_ttl_ms":ms,"require_active_version":field(&values,"require_active_version")=="yes"})).await
        }
        "activate" => {
            api.send(
                &headers,
                Method::PATCH,
                &["templates", &id, "versions"],
                &json!({"id":field(&values,"version")}),
            )
            .await
        }
        "archive" | "unarchive" => {
            api.send(
                &headers,
                Method::POST,
                &["templateversions", field(&values, "version"), command],
                &json!({}),
            )
            .await
        }
        "publish" => {
            if field(&values, "base_version") != t.active_version_id {
                return Err(UiError::new(
                    StatusCode::CONFLICT,
                    "The active version changed. Reload the editor before publishing.",
                ));
            }
            let source: Value = api
                .get(
                    &headers,
                    &["templateversions", &t.active_version_id, "source"],
                    &[],
                )
                .await?;
            let mut spec = source["provisioner_spec"].clone();
            spec["files"] = parse(&values, "files")?;
            api.send(&headers,Method::POST,&["organizations",&t.organization_id,"templateversions"],&json!({"template_id":id,"name":field(&values,"version_name"),"message":field(&values,"message"),"parameters":parse(&values,"parameters")?,"provisioner_spec":spec})).await
        }
        "delete" => {
            if field(&values, "confirm") != t.name {
                return Err(UiError::bad_request(
                    "Template name did not match. Nothing was deleted.",
                ));
            }
            api.send(&headers, Method::DELETE, &["templates", &id], &json!({}))
                .await
        }
        _ => return Err(UiError::bad_request("Unknown template action.")),
    };
    if let Err(error) = result {
        return Ok((
            error.status,
            settings_page(&api, &headers, &id, Some(&error.message)).await?,
        )
            .into_response());
    }
    Ok(Redirect::to(&if command == "delete" {
        "/templates".into()
    } else {
        format!("/templates/{}/settings", views::segment(&id))
    })
    .into_response())
}

#[cfg(test)]
mod tests {
    #[test]
    fn starter_source_is_valid_json() {
        let value: serde_json::Value = serde_json::from_str(super::EXAMPLE).unwrap();
        assert!(
            value["main.tf"]
                .as_str()
                .unwrap()
                .contains("coder_start_count")
        );
    }
}
