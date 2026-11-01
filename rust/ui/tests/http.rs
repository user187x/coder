//! UI behavior against an isolated mock of the existing Coder HTTP API.

use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::{HeaderMap, Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tower::ServiceExt;

#[derive(Clone, Debug)]
struct Call {
    method: Method,
    path: String,
    query: String,
    token: Option<String>,
    body: Value,
}

#[derive(Clone, Default)]
struct Backend {
    calls: Arc<Mutex<Vec<Call>>>,
    failures: Arc<Mutex<HashMap<String, StatusCode>>>,
}

struct Fixture {
    backend: Backend,
    app: Router,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn user() -> Value {
    json!({"id":"user-id","username":"greg","email":"greg@example.test","status":"active","roles":[{"name":"owner"}]})
}

fn workspace() -> Value {
    json!({"id":"workspace-id","name":"my-workspace","owner_name":"greg","template_name":"docker","template_display_name":"Docker","favorite":false,"outdated":false,
        "latest_build":{"id":"build-id","template_version_id":"version-id","status":"running","build_number":1,"resources":null}})
}

fn template() -> Value {
    json!({"id":"template-id","name":"docker","display_name":"Docker","organization_name":"default","active_version_id":"version-id","description":"A development container","deprecated":false,"deprecation_message":""})
}

async fn backend(State(state): State<Backend>, request: Request) -> Response {
    let path = request.uri().path().to_owned();
    let query = request.uri().query().unwrap_or_default().to_owned();
    let method = request.method().clone();
    let token = request
        .headers()
        .get("Coder-Session-Token")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let bytes = to_bytes(request.into_body(), 1_000_000).await.unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    state.calls.lock().unwrap().push(Call {
        method: method.clone(),
        path: path.clone(),
        query,
        token: token.clone(),
        body,
    });
    let failure = state.failures.lock().unwrap().get(&path).copied();
    if let Some(status) = failure {
        return (status, Json(json!({"message":"Permission denied <script>alert(1)</script>","validations":[{"field":"name","detail":"Already in use"}]}))).into_response();
    }
    if path == "/api/v2/users/authmethods" {
        return Json(json!({"password":{"enabled":true}})).into_response();
    }
    if path == "/api/v2/users/login" {
        return Json(json!({"session_token":"new-session-token"})).into_response();
    }
    if token.is_none() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"message":"Sign in required"})),
        )
            .into_response();
    }
    if path == "/api/v2/workspaces/redirect" {
        return (
            StatusCode::FOUND,
            [(header::LOCATION, "/api/v2/redirect-target")],
        )
            .into_response();
    }
    match (method.as_str(),path.as_str()) {
        ("GET","/api/v2/users/me") => Json(user()).into_response(),
        ("GET","/api/v2/workspaces") => Json(json!({"workspaces":[workspace()],"count":26})).into_response(),
        ("GET","/api/v2/workspaces/workspace-id") | ("GET","/api/v2/users/greg/workspace/my-workspace") => Json(workspace()).into_response(),
        ("GET","/api/v2/workspaces/workspace-id/builds") => Json(json!([workspace()["latest_build"].clone()])).into_response(),
        ("GET","/api/v2/users/greg/workspace/my-workspace/builds/1") => Json(workspace()["latest_build"].clone()).into_response(),
        ("GET","/api/v2/workspacebuilds/build-id/logs") => Json(json!([{"output":"Build ready <script>alert(1)</script>","log_level":"info","created_at":"2026-11-01T12:00:00Z"}])).into_response(),
        ("GET","/api/v2/templates") => Json(json!([template()])).into_response(),
        ("GET","/api/v2/templates/template-id") => Json(template()).into_response(),
        ("GET","/api/v2/templateversions/version-id/rich-parameters") => Json(json!([
            {"name":"region","type":"string","description_plaintext":"Region","default_value":"us-east-1","required":true,"options":[{"name":"US East","value":"us-east-1"}]},
            {"name":"cores","type":"number","description_plaintext":"CPU cores","default_value":"2","required":true,"options":null}
        ])).into_response(),
        ("POST","/api/v2/users/user-id/workspaces") => (StatusCode::CREATED,Json(workspace())).into_response(),
        ("GET","/api/v2/users/me/secrets") => Json(json!([])).into_response(),
        ("GET","/api/v2/deployment/user-secrets/capabilities") => Json(json!({"file_path_delivery_enabled":false})).into_response(),
        ("GET","/api/v2/users") => Json(json!({"users":[user()],"count":1})).into_response(),
        ("POST","/api/v2/users/me/secrets") | ("POST","/api/v2/workspaces/workspace-id/builds") => (StatusCode::CREATED,Json(json!({}))).into_response(),
        ("POST","/api/v2/users/logout") | ("PATCH","/api/v2/workspacebuilds/build-id/cancel") | ("PUT","/api/v2/users/me/profile") => Json(json!({})).into_response(),
        ("PUT","/api/v2/workspaces/workspace-id/favorite") => StatusCode::NO_CONTENT.into_response(),
        _ => (StatusCode::NOT_FOUND, Json(json!({"message":"Mock endpoint not found"}))).into_response(),
    }
}

impl Fixture {
    async fn new() -> Self {
        let state = Backend::default();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let backend_app = Router::new().fallback(backend).with_state(state.clone());
        let task = tokio::spawn(async move {
            axum::serve(listener, backend_app).await.unwrap();
        });
        let app = coder_ui::router(&format!("http://{address}"), "https://coder-ui.test").unwrap();
        Self {
            backend: state,
            app,
            task,
        }
    }

    async fn request(
        &self,
        method: Method,
        path: &str,
        body: &str,
        cookie: Option<&str>,
        origin: Option<&str>,
    ) -> (StatusCode, HeaderMap, String) {
        let mut request = Request::builder().method(method).uri(path);
        if let Some(cookie) = cookie {
            request = request.header(header::COOKIE, cookie);
        }
        if let Some(origin) = origin {
            request = request.header(header::ORIGIN, origin);
        }
        if !body.is_empty() {
            request = request.header(header::CONTENT_TYPE, "application/x-www-form-urlencoded");
        }
        let response = self
            .app
            .clone()
            .oneshot(request.body(Body::from(body.to_owned())).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = to_bytes(response.into_body(), 1_000_000).await.unwrap();
        (status, headers, String::from_utf8(bytes.to_vec()).unwrap())
    }

    async fn get(&self, path: &str) -> (StatusCode, HeaderMap, String) {
        self.request(
            Method::GET,
            path,
            "",
            Some("unrelated=private; coder_ui_session=test-session"),
            None,
        )
        .await
    }

    async fn post(&self, path: &str, body: &str) -> (StatusCode, HeaderMap, String) {
        self.request(
            Method::POST,
            path,
            body,
            Some("coder_ui_session=test-session"),
            Some("https://coder-ui.test"),
        )
        .await
    }

    fn mutations(&self) -> Vec<Call> {
        self.backend
            .calls
            .lock()
            .unwrap()
            .iter()
            .filter(|c| c.method != Method::GET)
            .cloned()
            .collect()
    }
}

#[tokio::test]
async fn unauthenticated_requests_redirect_without_rendering_private_data() {
    let f = Fixture::new().await;
    let (status, headers, body) = f.request(Method::GET, "/workspaces", "", None, None).await;
    assert_eq!(status, StatusCode::SEE_OTHER);
    assert_eq!(headers[header::LOCATION], "/login");
    assert!(!body.contains("my-workspace"));
}

#[tokio::test]
async fn workspace_search_uses_existing_api_pagination_and_session_header() {
    let f = Fixture::new().await;
    let (status, headers, body) = f
        .get("/workspaces?q=owner%3Ame+status%3Arunning&offset=25")
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.contains("my-workspace"));
    assert_eq!(headers[header::CACHE_CONTROL], "no-store");
    let calls = f.backend.calls.lock().unwrap();
    let call = calls
        .iter()
        .find(|c| c.path == "/api/v2/workspaces")
        .unwrap();
    let url = reqwest::Url::parse(&format!("http://localhost/?{}", call.query)).unwrap();
    let query: HashMap<_, _> = url.query_pairs().into_owned().collect();
    assert_eq!(query["q"], "owner:me status:running");
    assert_eq!(query["offset"], "25");
    assert_eq!(query["limit"], "25");
    assert_eq!(call.token.as_deref(), Some("test-session"));
}

#[tokio::test]
async fn login_sets_a_secure_http_only_cookie_without_rendering_the_token() {
    let f = Fixture::new().await;
    let (status, headers, body) = f
        .post(
            "/login",
            "method=password&email=greg&password=private-password",
        )
        .await;
    assert_eq!(status, StatusCode::SEE_OTHER);
    assert_eq!(headers[header::LOCATION], "/workspaces");
    let cookie = headers[header::SET_COOKIE].to_str().unwrap();
    assert!(cookie.contains("coder_ui_session=new-session-token"));
    assert!(cookie.contains("HttpOnly"));
    assert!(cookie.contains("SameSite=Lax"));
    assert!(cookie.contains("Secure"));
    assert!(!body.contains("new-session-token"));
    let call = &f.mutations()[0];
    assert_eq!(
        call.body,
        json!({"email":"greg","password":"private-password"})
    );
    assert!(call.token.is_none());
}

#[tokio::test]
async fn rejected_login_preserves_username_and_never_the_password() {
    let f = Fixture::new().await;
    f.backend
        .failures
        .lock()
        .unwrap()
        .insert("/api/v2/users/login".into(), StatusCode::UNAUTHORIZED);
    let (status, _, body) = f
        .post(
            "/login",
            "method=password&email=greg&password=private-password",
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(body.contains("value=\"greg\""));
    assert!(!body.contains("private-password"));
    assert!(body.contains("&lt;script&gt;"));
}

#[tokio::test]
async fn missing_and_foreign_origins_cannot_trigger_any_api_calls() {
    let f = Fixture::new().await;
    for origin in [
        None,
        Some("https://attacker.test"),
        Some("null"),
        Some("http://coder-ui.test"),
    ] {
        let (status, _, _) = f
            .request(
                Method::POST,
                "/workspaces/workspace-id/actions",
                "action=stop",
                Some("coder_ui_session=test-session"),
                origin,
            )
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
    assert!(f.backend.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn workspace_controls_send_the_correct_build_and_favorite_payloads() {
    let f = Fixture::new().await;
    for action in ["start", "stop", "restart", "cancel", "favorite"] {
        let (status, headers, _) = f
            .post(
                "/workspaces/workspace-id/actions",
                &format!("action={action}"),
            )
            .await;
        assert_eq!(status, StatusCode::SEE_OTHER, "{action}");
        assert_eq!(headers[header::LOCATION], "/workspaces/workspace-id");
    }
    let calls = f.mutations();
    assert_eq!(
        calls[0].body,
        json!({"transition":"start","reason":"dashboard"})
    );
    assert_eq!(calls[1].body, json!({"transition":"stop"}));
    assert_eq!(calls[2].body["on_success"]["transition"], "start");
    assert!(
        calls[2].body["on_success"]
            .get("template_version_id")
            .is_none()
    );
    assert_eq!(calls[3].method, Method::PATCH);
    assert_eq!(calls[3].path, "/api/v2/workspacebuilds/build-id/cancel");
    assert_eq!(calls[4].method, Method::PUT);
    assert_eq!(calls[4].path, "/api/v2/workspaces/workspace-id/favorite");
}

#[tokio::test]
async fn deletion_requires_the_current_workspace_name() {
    let f = Fixture::new().await;
    assert_eq!(
        f.post("/workspaces/workspace-id/delete", "name=wrong")
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert!(f.mutations().is_empty());
    assert_eq!(
        f.post("/workspaces/workspace-id/delete", "name=my-workspace")
            .await
            .0,
        StatusCode::SEE_OTHER
    );
    assert_eq!(f.mutations()[0].body, json!({"transition":"delete"}));
}

#[tokio::test]
async fn creation_maps_form_fields_to_parameter_names_and_rejects_stale_versions() {
    let f = Fixture::new().await;
    let (status, _, _) = f
        .post(
            "/templates/template-id/workspace",
            "name=test&version=old-version&parameter_0=us-east-1",
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(f.mutations().is_empty());
    let (status, headers, _) = f
        .post(
            "/templates/template-id/workspace",
            "name=test&version=version-id&parameter_0=us-east-1&parameter_1=4",
        )
        .await;
    assert_eq!(status, StatusCode::SEE_OTHER);
    assert_eq!(headers[header::LOCATION], "/workspaces/workspace-id");
    assert_eq!(
        f.mutations()[0].body,
        json!({"template_version_id":"version-id","name":"test","rich_parameter_values":[{"name":"region","value":"us-east-1"},{"name":"cores","value":"4"}],"autostart_schedule":null,"ttl_ms":null})
    );
}

#[tokio::test]
async fn failed_creation_keeps_submitted_fields_and_escapes_api_errors() {
    let f = Fixture::new().await;
    f.backend.failures.lock().unwrap().insert(
        "/api/v2/users/user-id/workspaces".into(),
        StatusCode::BAD_REQUEST,
    );
    let (status, _, body) = f
        .post(
            "/templates/template-id/workspace",
            "name=keep-me&version=version-id&parameter_0=us-east-1&parameter_1=8",
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.contains("value=\"keep-me\""));
    assert!(body.contains("value=\"8\""));
    assert!(body.contains("Already in use"));
    assert!(!body.contains("<script>"));
}

#[tokio::test]
async fn secret_validation_blocks_reserved_variables_and_never_reflects_values() {
    let f = Fixture::new().await;
    let (status, _, body) = f
        .post(
            "/settings/secrets",
            "name=token&value=private-secret-value&env_name=HOME&enabled=yes",
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.contains("reserved environment variable"));
    assert!(!body.contains("private-secret-value"));
    assert!(f.mutations().is_empty());
    assert_eq!(
        f.post(
            "/settings/secrets",
            "name=token&value=private-secret-value&env_name=API_KEY&enabled=yes"
        )
        .await
        .0,
        StatusCode::SEE_OTHER
    );
    assert_eq!(f.mutations()[0].body["value"], "private-secret-value");
}

#[tokio::test]
async fn logs_use_go_log_level_field_and_escape_output() {
    let f = Fixture::new().await;
    let (status, _, body) = f.get("/workspaces/workspace-id").await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.contains("[info]"));
    assert!(body.contains("Build ready &lt;script&gt;"));
    assert!(!body.contains("<script>"));
}

#[tokio::test]
async fn every_implemented_screen_renders_with_optional_go_fields_omitted() {
    let f = Fixture::new().await;
    for path in [
        "/login",
        "/workspaces",
        "/templates",
        "/templates/template-id",
        "/templates/template-id/workspace",
        "/workspaces/workspace-id",
        "/workspaces/workspace-id/delete",
        "/settings/account",
        "/settings/secrets",
        "/users",
    ] {
        assert_eq!(f.get(path).await.0, StatusCode::OK, "{path}");
    }
}

#[tokio::test]
async fn profile_changes_preserve_avatar_and_logout_revokes_the_session() {
    let f = Fixture::new().await;
    assert_eq!(
        f.post("/settings/account", "username=greg&name=Greg")
            .await
            .0,
        StatusCode::SEE_OTHER
    );
    assert_eq!(
        f.mutations()[0].body,
        json!({"username":"greg","name":"Greg","avatar_url":""})
    );
    let (status, headers, _) = f.post("/logout", "").await;
    assert_eq!(status, StatusCode::SEE_OTHER);
    assert!(
        headers[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .contains("Max-Age=0")
    );
    assert_eq!(f.mutations()[1].path, "/api/v2/users/logout");
}

#[tokio::test]
async fn callers_cannot_turn_backend_configuration_into_an_open_proxy() {
    for backend in [
        "ftp://localhost",
        "http://user:pass@localhost",
        "http://localhost/base",
        "http://localhost?query=yes",
    ] {
        assert!(coder_ui::router(backend, "http://localhost:8080").is_err());
    }
    let f = Fixture::new().await;
    assert_eq!(f.get("/api/v2/users/me").await.0, StatusCode::NOT_FOUND);
    assert!(f.backend.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn api_redirects_are_not_followed_with_the_session_token() {
    let f = Fixture::new().await;
    assert_eq!(
        f.get("/workspaces/redirect").await.0,
        StatusCode::BAD_GATEWAY
    );
    assert!(
        !f.backend
            .calls
            .lock()
            .unwrap()
            .iter()
            .any(|call| call.path == "/api/v2/redirect-target")
    );
}

#[tokio::test]
async fn sessions_are_attached_per_request_and_not_cached_between_users() {
    let f = Fixture::new().await;
    for token in ["first-user", "second-user"] {
        assert_eq!(
            f.request(
                Method::GET,
                "/workspaces",
                "",
                Some(&format!("coder_ui_session={token}")),
                None
            )
            .await
            .0,
            StatusCode::OK
        );
    }
    assert_eq!(
        f.request(Method::GET, "/workspaces", "", None, None)
            .await
            .0,
        StatusCode::SEE_OTHER
    );
    let calls = f.backend.calls.lock().unwrap();
    let me: Vec<_> = calls
        .iter()
        .filter(|c| c.path == "/api/v2/users/me")
        .map(|c| c.token.as_deref())
        .collect();
    assert_eq!(me, [Some("first-user"), Some("second-user"), None]);
}

#[tokio::test]
async fn release_workspace_urls_and_build_history() {
    let f = Fixture::new().await;
    let (status, _, body) = f.get("/@greg/my-workspace").await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.contains("Build history"));
    let (status, _, body) = f.get("/workspaces/workspace-id/builds").await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.contains("/@greg/my-workspace/builds/1"));
    let (status, _, body) = f.get("/@greg/my-workspace/builds/1").await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.contains("Build #1"));
    assert!(body.contains("&lt;script&gt;"));
    assert!(!body.contains("<script>alert"));
    // Historical builds must not render lifecycle actions for the current build.
    assert!(!body.contains("name=\"action\""));
    let (status, headers, _) = f.get("/@greg/my-workspace/terminal").await;
    assert_eq!(status, StatusCode::SEE_OTHER);
    assert_eq!(
        headers[header::LOCATION],
        "/workspaces/workspace-id/terminal"
    );
    f.backend.failures.lock().unwrap().insert(
        "/api/v2/users/greg/workspace/my-workspace".into(),
        StatusCode::FORBIDDEN,
    );
    assert_eq!(
        f.get("/@greg/my-workspace/builds/1").await.0,
        StatusCode::FORBIDDEN
    );
}
