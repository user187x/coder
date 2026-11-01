//! Rust-rendered organization role and identity administration.
use crate::{
    api::{Api, UiError},
    models::User,
    views,
};
use axum::{
    Form,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Redirect, Response},
};
use maud::html;
use reqwest::Method;
use serde_json::{Value, json};
use std::collections::HashMap;
type Result<T = Response> = std::result::Result<T, UiError>;
fn text(value: &Value) -> &str {
    value.as_str().unwrap_or("")
}

pub(crate) async fn organizations(State(api): State<Api>, headers: HeaderMap) -> Result {
    if api.full_application {
        return Err(UiError::new(
            StatusCode::NOT_FOUND,
            "Use the deployment access settings.",
        ));
    }
    let user: User = api.get(&headers, &["users", "me"], &[]).await?;
    let orgs: Vec<Value> = api
        .get(&headers, &["users", "me", "organizations"], &[])
        .await?;
    Ok(crate::html(views::page(
        "Access",
        Some(&user),
        Some(&api),
        html! {
            h1 { "Organization access" }
            p { "Manage roles, resource permissions, and member assignments. Organization access administrators and deployment owners can change these settings." }
            @for org in orgs {section.panel {a href=(format!("/settings/access/{}",text(&org["id"]))) { (text(&org["display_name"])) }}}
        },
    )))
}
pub(crate) async fn page(
    State(api): State<Api>,
    headers: HeaderMap,
    Path(org): Path<String>,
) -> Result {
    let user: User = api.get(&headers, &["users", "me"], &[]).await?;
    let data: Value = api
        .get(&headers, &["organizations", &org, "roles"], &[])
        .await?;
    let members: Vec<Value> = api
        .get(&headers, &["organizations", &org, "members"], &[])
        .await?;
    let methods: Value = api.get(&headers, &["users", "authmethods"], &[]).await?;
    let events: Vec<Value> = api
        .get(&headers, &["organizations", &org, "audit"], &[])
        .await
        .unwrap_or_default();
    let empty = Vec::new();
    let roles = data["roles"].as_array().unwrap_or(&empty);
    let post = format!("/settings/access/{org}");
    Ok(crate::html(views::page(
        "Access",
        Some(&user),
        Some(&api),
        html! {
            a.back href="/settings/access" { "Organizations" } h1 { "Roles and permissions" }
            p { "Members can use templates and manage their own workspaces by default. Roles add access; explicit denies override defaults and grants. Deployment owners retain full access within their organizations." }
            @for role in roles {
                section.panel { h2 { (text(&role["name"])) }
                    table {thead {tr {th {"Permission"} th {"Resource"} th {"Effect"}}} tbody {
                        @for permission in role["permissions"].as_array().unwrap_or(&empty) {
                            tr {td {(text(&permission["action"]))} td {@if permission["resource_id"].is_null() {"Organization"} @else {(text(&permission["resource_id"]))}} td {@if permission["allow"]==true {"Allow"} @else {"Deny"}}}
                        }
                    }}
                    form method="post" action=(&post) {input type="hidden" name="operation" value="delete"; input type="hidden" name="role" value=(text(&role["id"])); button type="submit" {"Delete role and its assignments"}}
                }
            }
            section.panel {h2 {"Create role"} form.stack method="post" action=(&post) {
                input type="hidden" name="operation" value="create";
                label for="role-name" {"Role name"} input id="role-name" name="name" maxlength="32" required;
                label for="scope" {"Resource ID (optional)"} input id="scope" name="resource" placeholder="Workspace or template UUID; empty means organization";
                p.muted {"Use a workspace ID with workspace permissions, or a template ID with template read/use. Creation and administration permissions apply to the whole organization."}
                table {thead {tr {th {"Permission"} th {"Allow"} th {"Deny"}}} tbody {
                    @for action in data["actions"].as_array().unwrap_or(&empty) {
                        tr {td {(text(action))} td {input type="checkbox" aria-label=(format!("Allow {}",text(action))) name=(format!("allow:{}",text(action))) value="true";} td {input type="checkbox" aria-label=(format!("Deny {}",text(action))) name=(format!("deny:{}",text(action))) value="true";}}
                    }
                }} button.primary type="submit" {"Create role"}
            }}
            section.panel {h2 {"Assign role"} form.stack method="post" action=(&post) {
                input type="hidden" name="operation" value="bind";
                label for="role" {"Role"} select id="role" name="role" required {@for role in roles {option value=(text(&role["id"])) {(text(&role["name"]))}}}
                label for="member" {"Member"} select id="member" name="user" required {@for member in &members {option value=(text(&member["id"])) {(text(&member["username"]))}}}
                button type="submit" {"Assign"}
            }
                h3 {"Current assignments"}
                @for binding in data["bindings"].as_array().unwrap_or(&empty) {
                    form.actions method="post" action=(&post) {
                        input type="hidden" name="operation" value="unbind";
                        input type="hidden" name="role" value=(text(&binding["role_id"])); input type="hidden" name="user" value=(text(&binding["user_id"]));
                        span {(roles.iter().find(|r|r["id"]==binding["role_id"]).map(|r|text(&r["name"])).unwrap_or("Role")) " / " (members.iter().find(|m|m["id"]==binding["user_id"]).map(|m|text(&m["username"])).unwrap_or("Member"))}
                        button type="submit" {"Remove assignment"}
                    }
                }
            }
            @if methods["oidc"]["enabled"]==true && user.roles.iter().any(|r|r.name=="owner") {
                section.panel {h2 {"Link SSO identity"} p {"Link a member to the configured identity provider using its exact subject claim. This disables their password login and revokes existing sessions."}
                    form.stack method="post" action=(&post) {
                        input type="hidden" name="operation" value="oidc";
                        label for="sso-member" {"Member"} select id="sso-member" name="user" required {@for member in &members {option value=(text(&member["id"])) {(text(&member["username"]))}}}
                        label for="subject" {"Identity provider subject"} input id="subject" name="subject" maxlength="512" required;
                        button type="submit" {"Convert member to SSO"}
                    }
                }
            }
            @if !events.is_empty() {section.panel {h2 {"Recent access events"} table {thead {tr {th {"When"} th {"Action"} th {"Actor"}}} tbody {
                @for event in events {tr {td {(text(&event["created_at"]))} td {(text(&event["action"]))} td {(text(&event["actor_id"]))}}}
            }}}}
        },
    )))
}
pub(crate) async fn change(
    State(api): State<Api>,
    headers: HeaderMap,
    Path(org): Path<String>,
    Form(values): Form<HashMap<String, String>>,
) -> Result {
    let value = |key: &str| values.get(key).map(String::as_str).unwrap_or("");
    let base = ["organizations", org.as_str(), "roles"];
    match value("operation") {
        "create" => {
            let mut permissions = Vec::new();
            for (key, v) in &values {
                if v == "true" {
                    if let Some((effect, action)) = key.split_once(':') {
                        if matches!(effect, "allow" | "deny") {
                            permissions.push(json!({"action":action,"allow":effect=="allow","resource_id":if value("resource").is_empty(){Value::Null}else{json!(value("resource"))}}));
                        }
                    }
                }
            }
            let _: Value = api
                .send(
                    &headers,
                    Method::POST,
                    &base,
                    &json!({"name":value("name"),"permissions":permissions}),
                )
                .await?;
        }
        "delete" => {
            let _: Value = api
                .send(
                    &headers,
                    Method::DELETE,
                    &[base[0], base[1], base[2], value("role")],
                    &Value::Null,
                )
                .await?;
        }
        "bind" | "unbind" => {
            let _: Value = api
                .send(
                    &headers,
                    if value("operation") == "bind" {
                        Method::PUT
                    } else {
                        Method::DELETE
                    },
                    &[
                        base[0],
                        base[1],
                        base[2],
                        value("role"),
                        "users",
                        value("user"),
                    ],
                    &Value::Null,
                )
                .await?;
        }
        "oidc" => {
            let _: Value = api
                .send(
                    &headers,
                    Method::PUT,
                    &["organizations", &org, "oidc", "users", value("user")],
                    &json!({"subject":value("subject")}),
                )
                .await?;
        }
        _ => return Err(UiError::bad_request("Unknown access action.")),
    }
    Ok(Redirect::to(&format!("/settings/access/{org}")).into_response())
}

fn token_page(api: &Api, user: &User, token: Option<&str>) -> Response {
    crate::html(views::page(
        "CLI access",
        Some(user),
        Some(api),
        html! {
            h1 {"CLI access"} p {"Create a token for the Rust CLI, SSH forwarding, and API requests. Tokens expire after one day and use your current permissions."}
            @if let Some(token)=token {section.panel {h2 {"Copy your token now"} p {"This value is shown once. Store it securely and set CODER_SESSION_TOKEN in your local environment."} pre {(token)}}}
            form method="post" action="/settings/tokens" {input type="hidden" name="operation" value="create";button.primary type="submit" {"Create one-day token"}}
            section.panel {h2 {"Revoke all sessions"} p {"Sign out every browser and CLI session, including this one. Active workspace connections close when their sessions are rechecked."}
            form method="post" action="/settings/tokens" {input type="hidden" name="operation" value="revoke";button type="submit" {"Revoke all and sign out"}}}
        },
    ))
}
pub(crate) async fn tokens(State(api): State<Api>, headers: HeaderMap) -> Result {
    let user: User = api.get(&headers, &["users", "me"], &[]).await?;
    Ok(token_page(&api, &user, None))
}
pub(crate) async fn token_action(
    State(api): State<Api>,
    headers: HeaderMap,
    Form(values): Form<HashMap<String, String>>,
) -> Result {
    let user: User = api.get(&headers, &["users", "me"], &[]).await?;
    match values.get("operation").map(String::as_str) {
        Some("create") => {
            let result: Value = api
                .send(
                    &headers,
                    Method::POST,
                    &["users", "me", "tokens"],
                    &Value::Null,
                )
                .await?;
            Ok(token_page(
                &api,
                &user,
                Some(text(&result["session_token"])),
            ))
        }
        Some("revoke") => {
            let _: Value = api
                .send(
                    &headers,
                    Method::DELETE,
                    &["users", "me", "sessions"],
                    &Value::Null,
                )
                .await?;
            let mut response = Redirect::to("/login").into_response();
            response.headers_mut().insert(
                axum::http::header::SET_COOKIE,
                crate::cookie("", api.origin.scheme() == "https", true)?,
            );
            Ok(response)
        }
        _ => Err(UiError::bad_request("Unknown token action.")),
    }
}
