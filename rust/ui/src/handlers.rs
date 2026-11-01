use crate::{
    api::{Api, UiError},
    models::*,
    views,
};
use axum::{
    Form,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Redirect, Response},
};
use reqwest::Method;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;

type Result<T = Response> = std::result::Result<T, UiError>;

async fn me(api: &Api, headers: &HeaderMap) -> Result<User> {
    api.get(headers, &["users", "me"], &[]).await
}

async fn auth(api: &Api, headers: &HeaderMap) -> Result<AuthMethods> {
    api.get(headers, &["users", "authmethods"], &[]).await
}

pub(crate) async fn login(State(api): State<Api>, headers: HeaderMap) -> Result {
    let auth = auth(&api, &headers).await?;
    Ok(crate::html(views::login(&api, &auth, "", None)))
}

#[derive(Deserialize)]
pub(crate) struct LoginForm {
    method: String,
    #[serde(default)]
    email: String,
    #[serde(default)]
    password: String,
    #[serde(default)]
    session_token: String,
    #[serde(default)]
    accept_terms: String,
}

pub(crate) async fn setup(State(api): State<Api>, headers: HeaderMap) -> Result {
    let first: Result<Value> = api.get(&headers, &["users", "first"], &[]).await;
    match first {
        Ok(_) => Ok(Redirect::to("/login").into_response()),
        Err(error) if error.status == StatusCode::NOT_FOUND => {
            Ok(crate::html(views::setup(&api, &HashMap::new(), None)))
        }
        Err(error) => Err(error),
    }
}

pub(crate) async fn create_first_user(
    State(api): State<Api>,
    headers: HeaderMap,
    Form(mut values): Form<HashMap<String, String>>,
) -> Result {
    let password = values.remove("password").unwrap_or_default();
    let field = |name: &str| values.get(name).map(String::as_str).unwrap_or_default();
    let result: Result<Value> = api.send(&HeaderMap::new(), Method::POST, &["users", "first"],
        &json!({"email":field("email"), "username":field("username"), "name":field("name"), "password":password})).await;
    if let Err(error) = result {
        return Ok((
            error.status,
            crate::html(views::setup(&api, &values, Some(&error.message))),
        )
            .into_response());
    }
    let login = LoginForm {
        method: "password".into(),
        email: field("email").into(),
        password,
        session_token: String::new(),
        accept_terms: "yes".into(),
    };
    sign_in(State(api), headers, Form(login)).await
}

pub(crate) async fn sign_in(
    State(api): State<Api>,
    headers: HeaderMap,
    Form(form): Form<LoginForm>,
) -> Result {
    let auth = auth(&api, &headers).await?;
    if !auth.terms_of_service_url.is_empty() && form.accept_terms != "yes" {
        return Ok((
            StatusCode::BAD_REQUEST,
            crate::html(views::login(
                &api,
                &auth,
                &form.email,
                Some("Accept the terms of service to continue."),
            )),
        )
            .into_response());
    }
    let token = match form.method.as_str() {
        "password" if auth.password.enabled => {
            let result: Result<LoginResponse> = api
                .send(
                    &HeaderMap::new(),
                    Method::POST,
                    &["users", "login"],
                    &json!({"email":form.email,"password":form.password}),
                )
                .await;
            match result {
                Ok(response) => response.session_token,
                Err(error) => {
                    return Ok((
                        error.status,
                        crate::html(views::login(&api, &auth, &form.email, Some(&error.message))),
                    )
                        .into_response());
                }
            }
        }
        "token" => {
            crate::cookie(&form.session_token, false, false)?;
            let mut verify = HeaderMap::new();
            verify.insert(
                header::COOKIE,
                format!("{}={}", crate::COOKIE_NAME, form.session_token)
                    .parse()
                    .map_err(|_| UiError::bad_request("Invalid session token."))?,
            );
            match me(&api, &verify).await {
                Ok(_) => form.session_token,
                Err(error) => {
                    return Ok((
                        error.status,
                        crate::html(views::login(&api, &auth, &form.email, Some(&error.message))),
                    )
                        .into_response());
                }
            }
        }
        _ => {
            return Err(UiError::bad_request(
                "This sign-in method is not available.",
            ));
        }
    };
    let mut response = Redirect::to("/workspaces").into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        crate::cookie(&token, api.origin.scheme() == "https", false)?,
    );
    Ok(response)
}

pub(crate) async fn sign_out(State(api): State<Api>, headers: HeaderMap) -> Result {
    let _: Value = api
        .send(&headers, Method::POST, &["users", "logout"], &json!({}))
        .await?;
    let mut response = Redirect::to("/login").into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        crate::cookie("", api.origin.scheme() == "https", true)?,
    );
    Ok(response)
}

#[derive(Deserialize, Default)]
pub(crate) struct Search {
    q: Option<String>,
    #[serde(default)]
    offset: usize,
}

fn search_params(search: &Search, default: &str) -> Result<(String, Vec<(&'static str, String)>)> {
    let q = search.q.as_deref().unwrap_or(default).to_owned();
    if q.len() > 2048 || search.offset > 1_000_000 {
        return Err(UiError::bad_request("Search or pagination limit exceeded."));
    }
    Ok((
        q.clone(),
        vec![
            ("q", q),
            ("offset", search.offset.to_string()),
            ("limit", "25".into()),
        ],
    ))
}

pub(crate) async fn workspaces(
    State(api): State<Api>,
    headers: HeaderMap,
    Query(search): Query<Search>,
) -> Result {
    let user = me(&api, &headers).await?;
    let (q, query) = search_params(&search, "user:me")?;
    let data: WorkspaceList = api.get(&headers, &["workspaces"], &query).await?;
    Ok(crate::html(views::workspaces(
        &api,
        &user,
        &data,
        &q,
        search.offset,
    )))
}

async fn get_workspace(api: &Api, headers: &HeaderMap, id: &str) -> Result<Workspace> {
    api.get(headers, &["workspaces", id], &[]).await
}

async fn workspace_page(
    api: &Api,
    headers: &HeaderMap,
    user: &User,
    w: &Workspace,
    message: Option<&str>,
) -> Response {
    let logs: Result<Vec<Log>> = api
        .list(headers, &["workspacebuilds", &w.latest_build.id, "logs"])
        .await;
    match logs {
        Ok(logs) => crate::html(views::workspace(api, user, w, &logs, None, message)),
        Err(error) => crate::html(views::workspace(
            api,
            user,
            w,
            &[],
            Some(&error.message),
            message,
        )),
    }
}

pub(crate) async fn workspace(
    State(api): State<Api>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result {
    let user = me(&api, &headers).await?;
    let w = get_workspace(&api, &headers, &id).await?;
    Ok(workspace_page(&api, &headers, &user, &w, None).await)
}

async fn named_workspace(
    api: &Api,
    headers: &HeaderMap,
    owner: &str,
    name: &str,
) -> Result<Workspace> {
    api.get(
        headers,
        &[
            "users",
            owner.strip_prefix('@').unwrap_or(owner),
            "workspace",
            name,
        ],
        &[],
    )
    .await
}

pub(crate) async fn workspace_by_name(
    State(api): State<Api>,
    headers: HeaderMap,
    Path((owner, name)): Path<(String, String)>,
) -> Result {
    let user = me(&api, &headers).await?;
    let w = named_workspace(&api, &headers, &owner, &name).await?;
    Ok(workspace_page(&api, &headers, &user, &w, None).await)
}

pub(crate) async fn terminal_by_name(
    State(api): State<Api>,
    headers: HeaderMap,
    Path((owner, name)): Path<(String, String)>,
) -> Result {
    let w = named_workspace(&api, &headers, &owner, &name).await?;
    // Keep the WebSocket bootstrap at the existing Origin-protected terminal route.
    Ok(Redirect::to(&format!("/workspaces/{}/terminal", views::segment(&w.id))).into_response())
}

pub(crate) async fn build_history(
    State(api): State<Api>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result {
    let user = me(&api, &headers).await?;
    let w = get_workspace(&api, &headers, &id).await?;
    let builds: Vec<Build> = api.list(&headers, &["workspaces", &id, "builds"]).await?;
    Ok(crate::html(views::build_history(&api, &user, &w, &builds)))
}

pub(crate) async fn build_by_number(
    State(api): State<Api>,
    headers: HeaderMap,
    Path((owner, name, number)): Path<(String, String, u32)>,
) -> Result {
    let user = me(&api, &headers).await?;
    let w = named_workspace(&api, &headers, &owner, &name).await?;
    let build: Build = api
        .get(
            &headers,
            &[
                "users",
                &w.owner_name,
                "workspace",
                &w.name,
                "builds",
                &number.to_string(),
            ],
            &[],
        )
        .await?;
    let logs: Vec<Log> = api
        .list(&headers, &["workspacebuilds", &build.id, "logs"])
        .await?;
    Ok(crate::html(views::build_detail(
        &api, &user, &w, &build, &logs,
    )))
}

#[derive(Deserialize)]
pub(crate) struct ActionForm {
    action: String,
}

pub(crate) async fn workspace_action(
    State(api): State<Api>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Form(form): Form<ActionForm>,
) -> Result {
    let user = me(&api, &headers).await?;
    let w = get_workspace(&api, &headers, &id).await?;
    let result: Result<Value> = match form.action.as_str() {
        "start" => api.send(&headers, Method::POST, &["workspaces", &id, "builds"],
            &json!({"transition":"start","template_version_id":w.latest_build.template_version_id,"reason":"dashboard"})).await,
        "stop" => api.send(&headers, Method::POST, &["workspaces", &id, "builds"], &json!({"transition":"stop"})).await,
        "restart" => api.send(&headers, Method::POST, &["workspaces", &id, "builds"],
            &json!({"transition":"stop","reason":"dashboard","on_success":{"transition":"start"}})).await,
        "cancel" => api.send(&headers, Method::PATCH, &["workspacebuilds", &w.latest_build.id, "cancel"], &json!({})).await,
        "favorite" => api.send(&headers, if w.favorite { Method::DELETE } else { Method::PUT }, &["workspaces", &id, "favorite"], &json!({})).await,
        _ => return Err(UiError::bad_request("Unknown workspace action.")),
    };
    if let Err(error) = result {
        return Ok((
            error.status,
            workspace_page(&api, &headers, &user, &w, Some(&error.message)).await,
        )
            .into_response());
    }
    Ok(Redirect::to(&format!("/workspaces/{}", views::segment(&id))).into_response())
}

pub(crate) async fn delete_workspace(
    State(api): State<Api>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result {
    let user = me(&api, &headers).await?;
    let w = get_workspace(&api, &headers, &id).await?;
    Ok(crate::html(views::delete_workspace(&api, &user, &w, None)))
}

#[derive(Deserialize)]
pub(crate) struct DeleteForm {
    name: String,
}

pub(crate) async fn confirm_delete(
    State(api): State<Api>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Form(form): Form<DeleteForm>,
) -> Result {
    let user = me(&api, &headers).await?;
    let w = get_workspace(&api, &headers, &id).await?;
    if form.name != w.name {
        return Ok((
            StatusCode::BAD_REQUEST,
            crate::html(views::delete_workspace(
                &api,
                &user,
                &w,
                Some("The workspace name did not match. Nothing was deleted."),
            )),
        )
            .into_response());
    }
    let result: Result<Value> = api
        .send(
            &headers,
            Method::POST,
            &["workspaces", &id, "builds"],
            &json!({"transition":"delete"}),
        )
        .await;
    if let Err(error) = result {
        return Ok((
            error.status,
            crate::html(views::delete_workspace(
                &api,
                &user,
                &w,
                Some(&error.message),
            )),
        )
            .into_response());
    }
    Ok(Redirect::to("/workspaces").into_response())
}

pub(crate) async fn templates(State(api): State<Api>, headers: HeaderMap) -> Result {
    let user = me(&api, &headers).await?;
    let templates: Vec<Template> = api.list(&headers, &["templates"]).await?;
    Ok(crate::html(views::templates(&api, &user, &templates)))
}

async fn get_template(api: &Api, headers: &HeaderMap, id: &str) -> Result<Template> {
    api.get(headers, &["templates", id], &[]).await
}

pub(crate) async fn template(
    State(api): State<Api>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result {
    let user = me(&api, &headers).await?;
    let template = get_template(&api, &headers, &id).await?;
    Ok(crate::html(views::template(&api, &user, &template)))
}

async fn parameters(api: &Api, headers: &HeaderMap, template: &Template) -> Result<Vec<Parameter>> {
    if template.deprecated {
        return Err(UiError::bad_request(
            "This template is deprecated. Select a different template.",
        ));
    }
    api.list(
        headers,
        &[
            "templateversions",
            &template.active_version_id,
            "rich-parameters",
        ],
    )
    .await
}

pub(crate) async fn new_workspace(
    State(api): State<Api>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result {
    let user = me(&api, &headers).await?;
    let template = get_template(&api, &headers, &id).await?;
    let params = parameters(&api, &headers, &template).await?;
    Ok(crate::html(views::new_workspace(
        &api,
        &user,
        &template,
        &params,
        &HashMap::new(),
        None,
    )))
}

pub(crate) async fn create_workspace(
    State(api): State<Api>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Form(values): Form<HashMap<String, String>>,
) -> Result {
    let user = me(&api, &headers).await?;
    let template = get_template(&api, &headers, &id).await?;
    let params = parameters(&api, &headers, &template).await?;
    if values.get("version") != Some(&template.active_version_id) {
        return Ok((
            StatusCode::CONFLICT,
            crate::html(views::new_workspace(
                &api,
                &user,
                &template,
                &params,
                &HashMap::new(),
                Some("The template changed. Review the current parameters and submit again."),
            )),
        )
            .into_response());
    }
    let rich: Vec<Value> = params.iter().enumerate().map(|(index,p)| json!({"name":p.name,"value":values.get(&format!("parameter_{index}")).unwrap_or(&p.default_value)})).collect();
    let result: Result<Workspace> = api.send(&headers, Method::POST, &["users", &user.id, "workspaces"],
        &json!({"template_version_id":template.active_version_id,"name":values.get("name").map(String::as_str).unwrap_or_default(),"rich_parameter_values":rich})).await;
    match result {
        Ok(w) => {
            Ok(Redirect::to(&format!("/workspaces/{}", views::segment(&w.id))).into_response())
        }
        Err(error) => Ok((
            error.status,
            crate::html(views::new_workspace(
                &api,
                &user,
                &template,
                &params,
                &values,
                Some(&error.message),
            )),
        )
            .into_response()),
    }
}

pub(crate) async fn account(State(api): State<Api>, headers: HeaderMap) -> Result {
    let user = me(&api, &headers).await?;
    Ok(crate::html(views::account(
        &api,
        &user,
        &user.username,
        &user.name,
        None,
    )))
}

#[derive(Deserialize)]
pub(crate) struct ProfileForm {
    username: String,
    name: String,
}

pub(crate) async fn save_account(
    State(api): State<Api>,
    headers: HeaderMap,
    Form(form): Form<ProfileForm>,
) -> Result {
    let user = me(&api, &headers).await?;
    let result: Result<Value> = api
        .send(
            &headers,
            Method::PUT,
            &["users", "me", "profile"],
            &json!({"username":form.username,"name":form.name,"avatar_url":user.avatar_url}),
        )
        .await;
    match result {
        Ok(_) => Ok(Redirect::to("/settings/account").into_response()),
        Err(error) => Ok((
            error.status,
            crate::html(views::account(
                &api,
                &user,
                &form.username,
                &form.name,
                Some(&error.message),
            )),
        )
            .into_response()),
    }
}

async fn file_delivery(api: &Api, headers: &HeaderMap) -> Result<bool> {
    let capability: Result<Value> = api
        .get(
            headers,
            &["deployment", "user-secrets", "capabilities"],
            &[],
        )
        .await;
    match capability {
        Ok(value) => Ok(value["file_path_delivery_enabled"]
            .as_bool()
            .unwrap_or(false)),
        Err(error) if error.status == StatusCode::NOT_FOUND => Ok(false),
        Err(error) => Err(error),
    }
}

pub(crate) async fn secrets(State(api): State<Api>, headers: HeaderMap) -> Result {
    let user = me(&api, &headers).await?;
    let data: Vec<Secret> = api.list(&headers, &["users", "me", "secrets"]).await?;
    let file_delivery = file_delivery(&api, &headers).await?;
    Ok(crate::html(views::secrets(
        &api,
        &user,
        &data,
        &HashMap::new(),
        None,
        file_delivery,
    )))
}

pub(crate) async fn create_secret(
    State(api): State<Api>,
    headers: HeaderMap,
    Form(mut values): Form<HashMap<String, String>>,
) -> Result {
    let user = me(&api, &headers).await?;
    let file_delivery = file_delivery(&api, &headers).await?;
    let value = values.remove("value").unwrap_or_default();
    let field = |name: &str| values.get(name).map(String::as_str).unwrap_or_default();
    let enabled = field("enabled") == "yes";
    let request = coder_core::secrets::CreateSecretRequest {
        name: field("name"),
        value: &value,
        env_name: field("env_name"),
        file_path: field("file_path"),
        enabled: Some(enabled),
    };
    let errors = coder_core::secrets::validate_create(&request);
    let result: Result<Value> = if !errors.is_empty() {
        Err(UiError::bad_request(
            errors
                .iter()
                .map(|e| format!("{}: {}", e.field, e.detail))
                .collect::<Vec<_>>()
                .join(" "),
        ))
    } else if !file_delivery && !request.file_path.is_empty() {
        Err(UiError::bad_request(
            "File delivery is disabled on this deployment.",
        ))
    } else {
        api.send(&headers, Method::POST, &["users", "me", "secrets"],
            &json!({"name":request.name,"value":value,"env_name":request.env_name,"file_path":request.file_path,"description":field("description"),"enabled":enabled})).await
    };
    match result {
        Ok(_) => Ok(Redirect::to("/settings/secrets").into_response()),
        Err(error) => {
            values.insert("enabled".into(), if enabled { "yes" } else { "no" }.into());
            let data: Vec<Secret> = api.list(&headers, &["users", "me", "secrets"]).await?;
            Ok((
                error.status,
                crate::html(views::secrets(
                    &api,
                    &user,
                    &data,
                    &values,
                    Some(&error.message),
                    file_delivery,
                )),
            )
                .into_response())
        }
    }
}

pub(crate) async fn users(
    State(api): State<Api>,
    headers: HeaderMap,
    Query(search): Query<Search>,
) -> Result {
    let user = me(&api, &headers).await?;
    let (q, query) = search_params(&search, "")?;
    let data: UserList = api.get(&headers, &["users"], &query).await?;
    Ok(crate::html(views::users(
        &api,
        &user,
        &data,
        &q,
        search.offset,
    )))
}

pub(crate) async fn terminal(
    State(api): State<Api>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result {
    if api.full_application {
        return Err(UiError::new(
            StatusCode::NOT_FOUND,
            "Use the deployment terminal.",
        ));
    }
    let user = me(&api, &headers).await?;
    let workspace: Workspace = api.get(&headers, &["workspaces", &id], &[]).await?;
    Ok(crate::html(views::terminal(&api, &user, &workspace)))
}
