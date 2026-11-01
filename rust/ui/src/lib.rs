//! A Rust-rendered UI using the existing authenticated Coder API.

mod access;
mod api;
mod handlers;
mod models;
mod views;

use api::{Api, UiError};
use axum::{
    Router,
    extract::{DefaultBodyLimit, Request, State},
    http::{HeaderValue, Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
};
use reqwest::Url;

const COOKIE_NAME: &str = "coder_ui_session";

/// Builds the UI router. Backend and browser origin must be HTTP(S) root URLs.
///
/// The browser origin is also the allowlist for form submissions. Configure it
/// to the external HTTPS origin when running behind a TLS reverse proxy.
pub fn router(backend: &str, browser_origin: &str) -> Result<Router, Box<dyn std::error::Error>> {
    build_router(backend, browser_origin, true)
}

/// Builds the UI for the Rust core, without links to unimplemented Go pages.
pub fn integrated_router(
    backend: &str,
    browser_origin: &str,
) -> Result<Router, Box<dyn std::error::Error>> {
    build_router(backend, browser_origin, false)
}

fn build_router(
    backend: &str,
    browser_origin: &str,
    full_application: bool,
) -> Result<Router, Box<dyn std::error::Error>> {
    let mut state = Api::new(root_url(backend)?, root_url(browser_origin)?)?;
    state.full_application = full_application;
    Ok(Router::new()
        .route("/", get(|| async { Redirect::to("/workspaces") }))
        .route("/login", get(handlers::login).post(handlers::sign_in))
        .route(
            "/setup",
            get(handlers::setup).post(handlers::create_first_user),
        )
        .route("/logout", post(handlers::sign_out))
        .route("/workspaces", get(handlers::workspaces))
        .route("/workspaces/{id}", get(handlers::workspace))
        .route("/workspaces/{id}/builds", get(handlers::build_history))
        .route("/{username}/{workspace}", get(handlers::workspace_by_name))
        .route(
            "/{username}/{workspace}/builds/{number}",
            get(handlers::build_by_number),
        )
        .route(
            "/{username}/{workspace}/terminal",
            get(handlers::terminal_by_name),
        )
        .route("/workspaces/{id}/terminal", get(handlers::terminal))
        .route(
            "/terminal.js",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
                    include_str!("terminal.js"),
                )
            }),
        )
        .route(
            "/xterm.js",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
                    include_str!("../assets/xterm.js"),
                )
            }),
        )
        .route(
            "/xterm.css",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
                    include_str!("../assets/xterm.css"),
                )
            }),
        )
        .route(
            "/xterm.LICENSE",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
                    include_str!("../assets/xterm.LICENSE"),
                )
            }),
        )
        .route("/workspaces/{id}/actions", post(handlers::workspace_action))
        .route(
            "/workspaces/{id}/delete",
            get(handlers::delete_workspace).post(handlers::confirm_delete),
        )
        .route("/templates", get(handlers::templates))
        .route("/templates/{id}", get(handlers::template))
        .route(
            "/templates/{id}/workspace",
            get(handlers::new_workspace).post(handlers::create_workspace),
        )
        .route(
            "/settings/account",
            get(handlers::account).post(handlers::save_account),
        )
        .route(
            "/settings/secrets",
            get(handlers::secrets).post(handlers::create_secret),
        )
        .route("/users", get(handlers::users))
        .route(
            "/settings/tokens",
            get(access::tokens).post(access::token_action),
        )
        .route("/settings/access", get(access::organizations))
        .route(
            "/settings/access/{org}",
            get(access::page).post(access::change),
        )
        .route(
            "/brix.gif",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "image/gif")],
                    include_bytes!("../assets/brix.gif").as_slice(),
                )
            }),
        )
        .route(
            "/style.css",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
                    include_str!("style.css"),
                )
            }),
        )
        .fallback(|| async {
            UiError::new(
                StatusCode::NOT_FOUND,
                "This page is not available in the Rust UI.",
            )
        })
        .layer(DefaultBodyLimit::max(64 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), boundary))
        .with_state(state))
}

fn root_url(value: &str) -> Result<Url, Box<dyn std::error::Error>> {
    let url = Url::parse(value)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("use an HTTP(S) root URL without credentials, path, query, or fragment".into());
    }
    Ok(url)
}

async fn boundary(State(api): State<Api>, request: Request, next: Next) -> Response {
    let terminal_page = request.uri().path().starts_with("/workspaces/")
        && request.uri().path().ends_with("/terminal");
    let origin_ok = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        == Some(api.origin.origin().ascii_serialization().as_str());
    let cross_site = request
        .headers()
        .get("sec-fetch-site")
        .is_some_and(|v| v == "cross-site");
    let mut response = if request.method() != Method::GET
        && request.method() != Method::HEAD
        && (!origin_ok || cross_site)
    {
        UiError::new(
            StatusCode::FORBIDDEN,
            "Form origin did not match this Coder UI.",
        )
        .into_response()
    } else {
        next.run(request).await
    };
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"));
    if terminal_page {
        headers.insert(header::CONTENT_SECURITY_POLICY,HeaderValue::from_static("default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"));
    }
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    response
}

fn html(markup: maud::Markup) -> Response {
    axum::response::Html(markup.into_string()).into_response()
}

fn cookie(token: &str, secure: bool, clear: bool) -> Result<HeaderValue, UiError> {
    if (!clear && token.is_empty())
        || !token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
        || token.len() > 1024
    {
        return Err(UiError::new(
            StatusCode::BAD_GATEWAY,
            "The API returned an invalid session token.",
        ));
    }
    let mut value = format!("{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax");
    if secure {
        value.push_str("; Secure");
    }
    if clear {
        value.push_str("; Max-Age=0");
    }
    HeaderValue::from_str(&value)
        .map_err(|_| UiError::new(StatusCode::BAD_GATEWAY, "Invalid session cookie."))
}
