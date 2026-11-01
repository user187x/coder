//! OIDC authorization-code login. Identity is (issuer, subject), never email matching.
use crate::{App, Error, Result, auth};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Redirect, Response},
};
use openidconnect::{
    AccessTokenHash, AuthorizationCode, ClientId, ClientSecret, CsrfToken, EndpointMaybeSet,
    EndpointNotSet, EndpointSet, IssuerUrl, Nonce, OAuth2TokenResponse, PkceCodeChallenge,
    PkceCodeVerifier, RedirectUrl, Scope, TokenResponse,
    core::{CoreAuthenticationFlow, CoreClient, CoreProviderMetadata},
};
use serde::Deserialize;
use serde_json::json;
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
use uuid::Uuid;

/// OIDC settings. Credentials deliberately do not implement Debug.
pub struct Config {
    pub issuer: String,
    pub client_id: String,
    pub client_secret: Option<String>,
    pub organization: Uuid,
    pub allow_signups: bool,
    pub password_enabled: bool,
}
type Client = CoreClient<
    EndpointSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointMaybeSet,
    EndpointMaybeSet,
>;
struct Flow {
    nonce: Nonce,
    verifier: PkceCodeVerifier,
    binding: String,
    created: Instant,
}
pub(crate) struct Provider {
    config: Config,
    redirect: RedirectUrl,
    secure: bool,
    http: Http,
    flows: Mutex<HashMap<String, Flow>>,
    slots: std::sync::Arc<tokio::sync::Semaphore>,
}
fn rejected() -> Error {
    Error(
        StatusCode::UNAUTHORIZED,
        "SSO could not be completed. Restart sign-in or contact your administrator.".into(),
    )
}

fn transport(url: &url::Url) -> bool {
    (url.scheme() == "https"
        || url.scheme() == "http"
            && url.host_str().is_some_and(|h| {
                h == "localhost"
                    || h.parse::<std::net::IpAddr>()
                        .is_ok_and(|ip| ip.is_loopback())
            }))
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
}
impl Provider {
    pub(crate) fn new(
        config: Config,
        origin: &str,
    ) -> std::result::Result<Self, Box<dyn std::error::Error>> {
        let issuer = url::Url::parse(&config.issuer).map_err(|_| "Invalid OIDC issuer")?;
        let origin = url::Url::parse(origin).map_err(|_| "Invalid OIDC browser origin")?;
        if !transport(&issuer)
            || issuer.query().is_some()
            || !transport(&origin)
            || config.client_id.is_empty()
            || config.client_id.len() > 1024
        {
            return Err("OIDC requires HTTPS (or loopback HTTP for development), an issuer without query parameters, and a client ID".into());
        }
        Ok(Self {
            config,
            redirect: RedirectUrl::new(origin.join("auth/oidc/callback")?.to_string())?,
            secure: origin.scheme() == "https",
            http: Http(
                reqwest::Client::builder()
                    .redirect(reqwest::redirect::Policy::none())
                    .timeout(Duration::from_secs(10))
                    .build()?,
                issuer.scheme() == "http",
            ),
            flows: Mutex::new(HashMap::new()),
            slots: std::sync::Arc::new(tokio::sync::Semaphore::new(16)),
        })
    }
    async fn client(&self) -> Result<Client> {
        let metadata = CoreProviderMetadata::discover_async(
            IssuerUrl::new(self.config.issuer.clone()).map_err(|_| rejected())?,
            &self.http,
        )
        .await
        .map_err(|_| rejected())?;
        if (issuer_requires_tls(&self.config.issuer)
            && metadata.authorization_endpoint().url().scheme() != "https")
            || !transport(metadata.authorization_endpoint().url())
            || metadata
                .token_endpoint()
                .is_none_or(|u| !transport(u.url()))
        {
            return Err(rejected());
        }
        Ok(CoreClient::from_provider_metadata(
            metadata,
            ClientId::new(self.config.client_id.clone()),
            self.config.client_secret.clone().map(ClientSecret::new),
        )
        .set_redirect_uri(self.redirect.clone()))
    }
}

pub(crate) async fn methods(State(app): State<App>) -> Json<serde_json::Value> {
    Json(
        json!({"password":{"enabled":app.oidc.as_ref().is_none_or(|p|p.config.password_enabled)},"oidc":{"enabled":app.oidc.is_some()}}),
    )
}
pub(crate) fn password_enabled(app: &App) -> bool {
    app.oidc.as_ref().is_none_or(|p| p.config.password_enabled)
}

fn flow_cookie(value: &str, secure: bool, clear: bool) -> HeaderValue {
    HeaderValue::from_str(&format!(
        "coder_oidc={value}; Path=/auth/oidc; HttpOnly; SameSite=Lax; Max-Age={}{}",
        if clear { 0 } else { 300 },
        if secure { "; Secure" } else { "" }
    ))
    .expect("random cookie")
}
fn cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    let mut values = headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|h| h.to_str().ok())
        .flat_map(|h| h.split(';'))
        .filter_map(|c| c.trim().split_once('='))
        .filter(|(n, _)| *n == name)
        .map(|(_, v)| v.to_owned());
    let value = values.next()?;
    if values.next().is_some() {
        None
    } else {
        Some(value)
    }
}

/// @Router /auth/oidc [get]
pub(crate) async fn start(State(app): State<App>) -> Result<Response> {
    let provider = app.oidc.as_ref().ok_or_else(rejected)?;
    let _slot = provider
        .slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| Error(StatusCode::TOO_MANY_REQUESTS, "SSO is busy.".into()))?;
    let client = provider.client().await?;
    let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
    let (url, state, nonce) = client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        .add_scope(Scope::new("email".into()))
        .add_scope(Scope::new("profile".into()))
        .set_pkce_challenge(challenge)
        .url();
    let binding = auth::token();
    let mut flows = provider.flows.lock().expect("OIDC flows");
    flows.retain(|_, f| f.created.elapsed() < Duration::from_secs(300));
    if flows.len() >= 1024 {
        return Err(Error(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many pending sign-ins.".into(),
        ));
    }
    flows.insert(
        auth::digest(state.secret()),
        Flow {
            nonce,
            verifier,
            binding: auth::digest(&binding),
            created: Instant::now(),
        },
    );
    let mut response = Redirect::to(url.as_str()).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        flow_cookie(&binding, provider.secure, false),
    );
    Ok(response)
}

#[derive(Deserialize)]
pub(crate) struct Callback {
    state: String,
    code: Option<String>,
    error: Option<String>,
}
/// @Router /auth/oidc/callback [get]
pub(crate) async fn callback(
    State(app): State<App>,
    headers: HeaderMap,
    Query(req): Query<Callback>,
) -> Result<Response> {
    let provider = app.oidc.as_ref().ok_or_else(rejected)?;
    let _slot = provider
        .slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| rejected())?;
    if req.state.len() > 256 {
        return Err(rejected());
    }
    let binding = cookie(&headers, "coder_oidc")
        .filter(|c| c.len() == 64)
        .ok_or_else(rejected)?;
    let flow = {
        let mut flows = provider.flows.lock().expect("OIDC flows");
        let key = auth::digest(&req.state);
        let flow = flows.get(&key).ok_or_else(rejected)?;
        if flow.binding != auth::digest(&binding)
            || flow.created.elapsed() >= Duration::from_secs(300)
        {
            return Err(rejected());
        }
        flows.remove(&key).expect("single-use flow")
    };
    if req.error.is_some() {
        return Err(rejected());
    }
    let code = req
        .code
        .filter(|c| !c.is_empty() && c.len() <= 4096)
        .ok_or_else(rejected)?;
    let client = provider.client().await?;
    let tokens = client
        .exchange_code(AuthorizationCode::new(code))
        .map_err(|_| rejected())?
        .set_pkce_verifier(flow.verifier)
        .request_async(&provider.http)
        .await
        .map_err(|_| rejected())?;
    let token = tokens.id_token().ok_or_else(rejected)?;
    let verifier = client.id_token_verifier();
    // OIDC Core 3.1.3.7: signature, issuer, audience, expiry and nonce are mandatory.
    let claims = token
        .claims(&verifier, &flow.nonce)
        .map_err(|_| rejected())?;
    if claims.issue_time() > chrono::Utc::now() + chrono::Duration::seconds(60)
        || claims.subject().is_empty()
        || claims.subject().len() > 512
    {
        return Err(rejected());
    }
    if let Some(expected) = claims.access_token_hash() {
        let actual = AccessTokenHash::from_token(
            tokens.access_token(),
            token.signing_alg().map_err(|_| rejected())?,
            token.signing_key(&verifier).map_err(|_| rejected())?,
        )
        .map_err(|_| rejected())?;
        if actual != *expected {
            return Err(rejected());
        }
    }
    let org = provider.config.organization;
    let issuer = &provider.config.issuer;
    let subject = claims.subject().as_str();
    let mut tx = app.pool.begin().await?;
    let mut user:Option<Uuid>=sqlx::query_scalar("SELECT i.user_id FROM coder_rust.oidc_identities i JOIN coder_rust.users u ON u.id=i.user_id JOIN coder_rust.memberships m ON m.user_id=u.id AND m.organization_id=i.organization_id WHERE i.issuer=$1 AND i.subject=$2 AND i.organization_id=$3 AND u.status='active' AND u.login_type='oidc'")
        .bind(issuer).bind(subject).bind(org).fetch_optional(&mut *tx).await?;
    if user.is_none() && provider.config.allow_signups {
        let email = claims
            .email()
            .filter(|e| e.len() <= 254 && e.contains('@') && !e.chars().any(char::is_whitespace))
            .ok_or_else(rejected)?;
        if claims.email_verified() != Some(true) {
            return Err(rejected());
        }
        let id = Uuid::new_v4();
        let username = format!("sso-{}", &id.simple().to_string()[..24]);
        // Email collisions fail; never auto-link a password account to an IdP identity.
        sqlx::query("INSERT INTO coder_rust.users(id,username,email,password_hash,login_type) VALUES($1,$2,$3,'!','oidc')")
            .bind(id).bind(username).bind(email.as_str()).execute(&mut *tx).await.map_err(|_|rejected())?;
        sqlx::query("INSERT INTO coder_rust.memberships VALUES($1,$2)")
            .bind(org)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO coder_rust.oidc_identities VALUES($1,$2,$3,$4)")
            .bind(issuer)
            .bind(subject)
            .bind(id)
            .bind(org)
            .execute(&mut *tx)
            .await
            .map_err(|_| rejected())?;
        user = Some(id);
    }
    let user = user.ok_or_else(rejected)?;
    let session = auth::token();
    sqlx::query("INSERT INTO coder_rust.sessions VALUES($1,$2,now()+interval '1 day')")
        .bind(auth::digest(&session))
        .bind(user)
        .execute(&mut *tx)
        .await?;
    crate::rbac::audit(&mut tx, org, user, "login.oidc", None).await?;
    tx.commit().await?;
    let mut response = Redirect::to("/workspaces").into_response();
    response.headers_mut().append(
        header::SET_COOKIE,
        HeaderValue::from_str(&format!(
            "coder_ui_session={session}; Path=/; HttpOnly; SameSite=Lax{}",
            if provider.secure { "; Secure" } else { "" }
        ))
        .expect("session cookie"),
    );
    response
        .headers_mut()
        .append(header::SET_COOKIE, flow_cookie("", provider.secure, true));
    Ok(response)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Link {
    subject: String,
}
/// @Router /api/v2/organizations/{org}/oidc/users/{user} [put]
pub(crate) async fn link(
    State(app): State<App>,
    headers: HeaderMap,
    Path((org, user)): Path<(Uuid, Uuid)>,
    Json(req): Json<Link>,
) -> Result<StatusCode> {
    let actor = auth::actor(&app, &headers).await?;
    actor.admin()?;
    crate::member(&app, actor.id, org).await?;
    crate::member(&app, user, org).await?;
    let provider = app.oidc.as_ref().ok_or_else(rejected)?;
    if org != provider.config.organization || req.subject.is_empty() || req.subject.len() > 512 {
        return Err(Error::bad("Invalid OIDC identity or organization."));
    }
    let mut tx = app.pool.begin().await?;
    // Protect the break-glass owner from accidental conversion or lockout.
    let updated=sqlx::query("UPDATE coder_rust.users SET login_type='oidc',password_hash='!' WHERE id=$1 AND NOT is_admin").bind(user).execute(&mut *tx).await?;
    if updated.rows_affected() != 1 {
        return Err(Error::bad(
            "Deployment owner accounts remain password accounts.",
        ));
    }
    sqlx::query("DELETE FROM coder_rust.oidc_identities WHERE issuer=$1 AND user_id=$2")
        .bind(&provider.config.issuer)
        .bind(user)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO coder_rust.oidc_identities VALUES($1,$2,$3,$4)")
        .bind(&provider.config.issuer)
        .bind(req.subject)
        .bind(user)
        .bind(org)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM coder_rust.sessions WHERE user_id=$1")
        .bind(user)
        .execute(&mut *tx)
        .await?;
    crate::rbac::audit(&mut tx, org, actor.id, "identity.link", Some(user)).await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

struct Http(reqwest::Client, bool);
impl Http {
    // Bound all discovery/JWKS/token bodies and reject redirects, including in discovery.
    async fn request(
        &self,
        request: openidconnect::HttpRequest,
    ) -> std::io::Result<openidconnect::HttpResponse> {
        let url = url::Url::parse(&request.uri().to_string())
            .map_err(|_| std::io::Error::other("OIDC URI"))?;
        if !transport(&url) || (url.scheme() != "https" && !self.1) {
            return Err(std::io::Error::other("OIDC transport"));
        }
        let request = reqwest::Request::try_from(request)
            .map_err(|_| std::io::Error::other("OIDC request"))?;
        let mut response = self
            .0
            .execute(request)
            .await
            .map_err(|_| std::io::Error::other("OIDC unavailable"))?;
        let mut out = axum::http::Response::builder().status(response.status());
        *out.headers_mut().expect("response headers") = response.headers().clone();
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| std::io::Error::other("OIDC body"))?
        {
            if body.len() + chunk.len() > 512 * 1024 {
                return Err(std::io::Error::other("OIDC body limit"));
            }
            body.extend_from_slice(&chunk);
        }
        out.body(body)
            .map_err(|_| std::io::Error::other("OIDC response"))
    }
}
impl<'a> openidconnect::AsyncHttpClient<'a> for Http {
    type Error = std::io::Error;
    type Future = std::pin::Pin<
        Box<
            dyn std::future::Future<Output = std::io::Result<openidconnect::HttpResponse>>
                + Send
                + 'a,
        >,
    >;
    fn call(&'a self, request: openidconnect::HttpRequest) -> Self::Future {
        Box::pin(self.request(request))
    }
}

fn issuer_requires_tls(issuer: &str) -> bool {
    issuer.starts_with("https:")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transport_and_cookie_validation_reject_ambiguous_credentials() {
        for url in [
            "http://identity.example.com",
            "https://user:secret@example.com",
            "https://example.com/#fragment",
            "file:///etc/passwd",
        ] {
            assert!(!transport(&url::Url::parse(url).unwrap()));
        }
        for url in [
            "https://identity.example.com/realm",
            "http://127.0.0.1:1234",
        ] {
            assert!(transport(&url::Url::parse(url).unwrap()));
        }
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            "coder_oidc=one; coder_oidc=two".parse().unwrap(),
        );
        assert!(cookie(&headers, "coder_oidc").is_none());
        let value = flow_cookie("test", true, false);
        assert!(
            value
                .to_str()
                .unwrap()
                .contains("HttpOnly; SameSite=Lax; Max-Age=300; Secure")
        );
    }
    #[tokio::test]
    async fn expired_state_is_rejected_before_provider_or_database_access() {
        let provider = Provider::new(
            Config {
                issuer: "https://idp.invalid".into(),
                client_id: "client".into(),
                client_secret: None,
                organization: Uuid::new_v4(),
                allow_signups: false,
                password_enabled: true,
            },
            "https://coder.invalid",
        )
        .unwrap();
        provider.flows.lock().unwrap().insert(
            auth::digest("state"),
            Flow {
                nonce: Nonce::new("nonce".into()),
                verifier: PkceCodeVerifier::new("verifier".into()),
                binding: auth::digest(&"a".repeat(64)),
                created: Instant::now() - Duration::from_secs(301),
            },
        );
        let app = App {
            pool: sqlx::postgres::PgPoolOptions::new()
                .connect_lazy("postgres://postgres@127.0.0.1:1/postgres")
                .unwrap(),
            broker: std::sync::Arc::new(crate::network::Broker::default()),
            hashes: std::sync::Arc::new(tokio::sync::Semaphore::new(1)),
            secret_key: None,
            oidc: Some(std::sync::Arc::new(provider)),
            browser_origin: "https://coder.invalid".into(),
        };
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            format!("coder_oidc={}", "a".repeat(64)).parse().unwrap(),
        );
        let result = callback(
            State(app),
            headers,
            Query(Callback {
                state: "state".into(),
                code: Some("code".into()),
                error: None,
            }),
        )
        .await;
        assert_eq!(result.unwrap_err().0, StatusCode::UNAUTHORIZED);
    }
}
