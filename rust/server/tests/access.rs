//! Real OIDC signatures/PKCE, PostgreSQL policies and a browser-to-agent native PTY.
//! fixtures/oidc-test-key.pem is a public test-only RSA key, never a deployment credential.
use axum::{
    Json, Router,
    extract::State,
    http::HeaderMap,
    routing::{get, post},
};
use futures_util::{SinkExt, StreamExt};
use openidconnect::{
    AccessToken, Audience, EmptyAdditionalClaims, EndUserEmail, IssuerUrl, Nonce,
    PkceCodeChallenge, PkceCodeVerifier, PrivateSigningKey, StandardClaims, SubjectIdentifier,
    core::{CoreIdToken, CoreIdTokenClaims, CoreJwsSigningAlgorithm, CoreRsaPrivateSigningKey},
};
use reqwest::{Client, Method, StatusCode};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{net::TcpListener, sync::watch};
use tokio_tungstenite::tungstenite::{Message, client::IntoClientRequest};
use uuid::Uuid;

struct Idp {
    base: String,
    email: String,
    collision_email: String,
    mode: Mutex<String>,
    codes: Mutex<HashMap<String, (String, String)>>,
    key: CoreRsaPrivateSigningKey,
}
async fn metadata(State(idp): State<Arc<Idp>>) -> Json<Value> {
    Json(
        json!({"issuer":idp.base,"authorization_endpoint":format!("{}/authorize",idp.base),"token_endpoint":format!("{}/token",idp.base),"jwks_uri":format!("{}/jwks",idp.base),"response_types_supported":["code"],"subject_types_supported":["public"],"id_token_signing_alg_values_supported":["RS256"]}),
    )
}
async fn jwks(State(idp): State<Arc<Idp>>) -> Json<Value> {
    Json(json!({"keys":[idp.key.as_verification_key()]}))
}
async fn token(
    State(idp): State<Arc<Idp>>,
    headers: HeaderMap,
    body: String,
) -> (StatusCode, Json<Value>) {
    let form: url::form_urlencoded::Parse<'_> = url::form_urlencoded::parse(body.as_bytes());
    let f: HashMap<String, String> = form.into_owned().collect();
    let failure = || {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"invalid_grant"})),
        )
    };
    if headers.get("authorization").and_then(|h| h.to_str().ok())
        != Some("Basic Y2xpZW50OnNlY3JldA==")
        || f.get("grant_type").map(String::as_str) != Some("authorization_code")
    {
        return failure();
    }
    let Some(code) = f.get("code") else {
        return failure();
    };
    let Some((nonce, challenge)) = idp.codes.lock().unwrap().remove(code) else {
        return failure();
    };
    let Some(verifier) = f.get("code_verifier") else {
        return failure();
    };
    if PkceCodeChallenge::from_code_verifier_sha256(&PkceCodeVerifier::new(verifier.clone()))
        .as_str()
        != challenge
    {
        return failure();
    }
    let mode = idp.mode.lock().unwrap().clone();
    let now = chrono::Utc::now();
    let issuer = if mode == "issuer" {
        "https://wrong.example".into()
    } else {
        idp.base.clone()
    };
    let claims = CoreIdTokenClaims::new(
        IssuerUrl::new(issuer).unwrap(),
        vec![Audience::new(
            if mode == "audience" {
                "wrong"
            } else {
                "client"
            }
            .into(),
        )],
        now + chrono::Duration::seconds(if mode == "expired" { -30 } else { 300 }),
        now,
        StandardClaims::new(SubjectIdentifier::new(
            if mode == "collision" {
                "collision"
            } else if mode == "linked" {
                "subject-2"
            } else {
                "subject-1"
            }
            .into(),
        ))
        .set_email(Some(EndUserEmail::new(if mode == "collision" {
            idp.collision_email.clone()
        } else {
            idp.email.clone()
        })))
        .set_email_verified(Some(mode != "unverified")),
        EmptyAdditionalClaims {},
    )
    .set_nonce(Some(Nonce::new(if mode == "nonce" {
        "incorrect".into()
    } else {
        nonce
    })));
    let mut token = CoreIdToken::new(
        claims,
        &idp.key,
        CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256,
        Some(&AccessToken::new("access".into())),
        None,
    )
    .unwrap()
    .to_string();
    if mode == "signature" {
        let index = token.rfind('.').unwrap() + 10;
        token.replace_range(
            index..index + 1,
            if &token[index..index + 1] == "A" {
                "B"
            } else {
                "A"
            },
        );
    }
    (
        StatusCode::OK,
        Json(
            json!({"access_token":if mode=="hash" {"substituted"}else{"access"},"token_type":"Bearer","id_token":token}),
        ),
    )
}

struct Fixture {
    base: String,
    http: Client,
    tasks: Vec<tokio::task::JoinHandle<()>>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
    }
}
impl Fixture {
    async fn call(
        &self,
        method: Method,
        path: &str,
        token: &str,
        body: Value,
    ) -> (StatusCode, Value) {
        let response = self
            .http
            .request(method, format!("{}{path}", self.base))
            .header("Coder-Session-Token", token)
            .json(&body)
            .send()
            .await
            .unwrap();
        let status = response.status();
        let bytes = response.bytes().await.unwrap();
        (
            status,
            if bytes.is_empty() {
                Value::Null
            } else {
                serde_json::from_slice(&bytes).unwrap()
            },
        )
    }
    async fn flow(&self, idp: &Idp, mode: &str) -> (String, String) {
        *idp.mode.lock().unwrap() = mode.into();
        let start = self
            .http
            .get(format!("{}/auth/oidc", self.base))
            .send()
            .await
            .unwrap();
        assert_eq!(start.status(), StatusCode::SEE_OTHER);
        let cookie = start.headers()["set-cookie"]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_owned();
        let url = url::Url::parse(start.headers()["location"].to_str().unwrap()).unwrap();
        let q: HashMap<String, String> = url.query_pairs().into_owned().collect();
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["response_type"], "code");
        let code = Uuid::new_v4().to_string();
        idp.codes.lock().unwrap().insert(
            code.clone(),
            (q["nonce"].clone(), q["code_challenge"].clone()),
        );
        let mut callback = url::Url::parse(&format!("{}/auth/oidc/callback", self.base)).unwrap();
        callback
            .query_pairs_mut()
            .append_pair("state", &q["state"])
            .append_pair("code", &code);
        (callback.to_string(), cookie)
    }
}
async fn pool() -> sqlx::PgPool {
    let url = std::env::var("CODER_TEST_DATABASE_URL").expect("Dedicated test database required");
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(
            if std::env::var_os("CODER_TEST_SINGLE_CONNECTION").is_some() {
                1
            } else {
                10
            },
        )
        .connect(&url)
        .await
        .unwrap();
    coder_server::migrate(&pool).await.unwrap();
    pool
}
fn hash(s: &str) -> String {
    Sha256::digest(s.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
async fn user(pool: &sqlx::PgPool, org: Uuid, name: &str, admin: bool) -> (Uuid, String) {
    let id = Uuid::new_v4();
    let session = Uuid::new_v4().simple().to_string();
    sqlx::query("INSERT INTO coder_rust.users(id,username,email,password_hash,is_admin) VALUES($1,$2,$3,'!', $4)").bind(id).bind(format!("{name}-{}",&id.simple().to_string()[..6])).bind(format!("{name}-{id}@example.test")).bind(admin).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO coder_rust.memberships VALUES($1,$2)")
        .bind(org)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO coder_rust.sessions VALUES($1,$2,now()+interval '1 hour')")
        .bind(hash(&session))
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    (id, session)
}
async fn until_output<S>(ws: &mut S, needle: &str) -> String
where
    S: futures_util::Stream<Item = Result<Message, tokio_tungstenite::tungstenite::Error>>
        + futures_util::Sink<Message>
        + Unpin,
    S::Error: std::fmt::Debug,
{
    tokio::time::timeout(Duration::from_secs(15), async {
        let mut output = String::new();
        loop {
            match ws.next().await.expect("terminal open").unwrap() {
                Message::Binary(bytes) => {
                    output.push_str(&String::from_utf8_lossy(&bytes));
                    if output.contains(needle) {
                        return output;
                    }
                }
                Message::Ping(bytes) => ws.send(Message::Pong(bytes)).await.unwrap(),
                Message::Pong(_) => {}
                m => panic!("Unexpected terminal frame {m:?}: {output}"),
            }
        }
    })
    .await
    .expect("terminal output deadline")
}

#[tokio::test]
#[ignore = "Requires a dedicated PostgreSQL database and a Unix PTY"]
async fn oidc_roles_and_browser_terminal_enforce_boundaries() {
    tokio::time::timeout(Duration::from_secs(120),async {
        let pool=pool().await;let org=Uuid::new_v4();
        sqlx::query("INSERT INTO coder_rust.organizations VALUES($1,$2,'Access test')").bind(org).bind(org.to_string()).execute(&pool).await.unwrap();
        let (_,owner)=user(&pool,org,"access-owner",true).await;
        let (alice,alice_session)=user(&pool,org,"alice",false).await;
        let (bob,bob_session)=user(&pool,org,"bob",false).await;
        let idp_listener=TcpListener::bind("127.0.0.1:0").await.unwrap();
        let idp=Arc::new(Idp{email:format!("sso-{org}@example.test"),collision_email:format!("alice-{alice}@example.test"),base:format!("http://{}",idp_listener.local_addr().unwrap()),mode:Mutex::new("valid".into()),codes:Mutex::new(HashMap::new()),key:CoreRsaPrivateSigningKey::from_pem(include_str!("fixtures/oidc-test-key.pem"),None).unwrap()});
        let idp_router=Router::new().route("/.well-known/openid-configuration",get(metadata)).route("/jwks",get(jwks)).route("/token",post(token)).with_state(idp.clone());
        let idp_task=tokio::spawn(async move {axum::serve(idp_listener,idp_router).await.unwrap();});
        let listener=TcpListener::bind("127.0.0.1:0").await.unwrap();let base=format!("http://{}",listener.local_addr().unwrap());
        let app=coder_server::api_with_options(pool.clone(),Some([31;32]),&base,Some(coder_server::oidc::Config{issuer:idp.base.clone(),client_id:"client".into(),client_secret:Some("secret".into()),organization:org,allow_signups:true,password_enabled:true})).unwrap().merge(coder_ui::integrated_router(&base,&base).unwrap());
        let task=tokio::spawn(async move {axum::serve(listener,app).await.unwrap();});
        let mut f=Fixture{base,http:Client::builder().redirect(reqwest::redirect::Policy::none()).build().unwrap(),tasks:vec![task,idp_task]};
        // Real signed tokens, discovery and PKCE; each negative case starts a new flow.
        for mode in ["nonce","issuer","audience","expired","signature","hash","unverified","collision"] {
            let (url,cookie)=f.flow(&idp,mode).await;
            let response=f.http.get(url).header("Cookie",cookie).send().await.unwrap();
            assert_eq!(response.status(),StatusCode::UNAUTHORIZED,"{mode}");assert!(response.headers().get("set-cookie").is_none());
        }
        let (url,cookie)=f.flow(&idp,"valid").await;
        assert_eq!(f.http.get(&url).header("Cookie","coder_oidc=wrong").send().await.unwrap().status(),StatusCode::UNAUTHORIZED);
        let response=f.http.get(&url).header("Cookie",&cookie).send().await.unwrap();assert_eq!(response.status(),StatusCode::SEE_OTHER);
        let session_cookie=response.headers().get_all("set-cookie").iter().filter_map(|v|v.to_str().ok()).find(|v|v.starts_with("coder_ui_session=")).unwrap();
        assert!(session_cookie.contains("HttpOnly") && session_cookie.contains("SameSite=Lax"));
        let session=session_cookie.split(';').next().unwrap().split_once('=').unwrap().1;
        let (_,me)=f.call(Method::GET,"/api/v2/users/me",session,Value::Null).await;assert_eq!(me["login_type"],"oidc");
        assert_eq!(f.http.get(&url).header("Cookie",&cookie).send().await.unwrap().status(),StatusCode::UNAUTHORIZED,"state replay");
        assert_eq!(f.call(Method::POST,"/api/v2/users/login","",json!({"email":idp.email,"password":"anything"})).await.0,StatusCode::UNAUTHORIZED);
        let (_,cli)=f.call(Method::POST,"/api/v2/users/me/tokens",session,Value::Null).await;
        let cli=cli["session_token"].as_str().unwrap();
        assert_eq!(f.call(Method::GET,"/api/v2/users/me",cli,Value::Null).await.0,StatusCode::OK);
        assert_eq!(f.call(Method::DELETE,"/api/v2/users/me/sessions",session,Value::Null).await.0,StatusCode::OK);
        assert_eq!(f.call(Method::GET,"/api/v2/users/me",cli,Value::Null).await.0,StatusCode::UNAUTHORIZED);
        let sso_user=me["id"].as_str().unwrap();
        assert_eq!(f.call(Method::PATCH,&format!("/api/v2/users/{sso_user}/status"),&owner,json!({"status":"suspended"})).await.0,StatusCode::OK);
        let (url,cookie)=f.flow(&idp,"valid").await;
        assert_eq!(f.http.get(url).header("Cookie",cookie).send().await.unwrap().status(),StatusCode::UNAUTHORIZED);
        // Workspace sharing is explicitly granted, with deny overriding owner defaults.
        let (_,template)=f.call(Method::POST,&format!("/api/v2/organizations/{org}/templates"),&owner,json!({"name":"access-test","provisioner_spec":{"driver":"test"}})).await;
        let (status,w)=f.call(Method::POST,"/api/v2/users/me/workspaces",&alice_session,json!({"name":"shared","template_id":template["id"]})).await;assert_eq!(status,StatusCode::CREATED,"{w}");
        let id:Uuid=w["id"].as_str().unwrap().parse().unwrap();let path=format!("/api/v2/workspaces/{id}");
        sqlx::query("UPDATE coder_rust.builds SET status='running' WHERE workspace_id=$1").bind(id).execute(&pool).await.unwrap();
        assert_eq!(f.call(Method::GET,&path,&bob_session,Value::Null).await.0,StatusCode::FORBIDDEN);
        let role=Uuid::new_v4();let role_path=format!("/api/v2/organizations/{org}/roles/{role}");
        let permissions=json!({"name":"terminal-reader","permissions":[{"action":"workspace.read","resource_id":id,"allow":true},{"action":"workspace.terminal","resource_id":id,"allow":true}]});
        assert_eq!(f.call(Method::PUT,&role_path,&bob_session,permissions.clone()).await.0,StatusCode::FORBIDDEN);
        assert_eq!(f.call(Method::PUT,&role_path,&owner,permissions).await.0,StatusCode::OK);
        let binding=format!("{role_path}/users/{bob}");assert_eq!(f.call(Method::PUT,&binding,&owner,Value::Null).await.0,StatusCode::NO_CONTENT);
        assert_eq!(f.call(Method::GET,&path,&bob_session,Value::Null).await.0,StatusCode::OK);
        let (_,listing)=f.call(Method::GET,"/api/v2/workspaces",&bob_session,Value::Null).await;assert_eq!(listing["count"],1);
        let (_,listing)=f.call(Method::GET,"/api/v2/workspaces?q=user:me",&bob_session,Value::Null).await;assert_eq!(listing["count"],1);
        let (_,listing)=f.call(Method::GET,"/api/v2/workspaces?q=owner:me",&bob_session,Value::Null).await;assert_eq!(listing["count"],0);
        let (_,listing)=f.call(Method::GET,"/api/v2/workspaces?q=user:me",&owner,Value::Null).await;assert_eq!(listing["count"],0,"Administrator visibility must not be mistaken for explicit sharing");

        for action in ["stop","delete"] {assert_eq!(f.call(Method::POST,&format!("{path}/builds"),&bob_session,json!({"transition":action})).await.0,StatusCode::FORBIDDEN);}
        assert_eq!(f.call(Method::POST,&format!("{path}/agent"),&bob_session,json!({"ports":[22],"terminal":true})).await.0,StatusCode::FORBIDDEN);
        let deny=Uuid::new_v4();let deny_path=format!("/api/v2/organizations/{org}/roles/{deny}");
        assert_eq!(f.call(Method::PUT,&deny_path,&owner,json!({"name":"no-stop","permissions":[{"action":"workspace.stop","resource_id":id,"allow":false}]})).await.0,StatusCode::OK);
        assert_eq!(f.call(Method::PUT,&format!("{deny_path}/users/{alice}"),&owner,Value::Null).await.0,StatusCode::NO_CONTENT);
        assert_eq!(f.call(Method::POST,&format!("{path}/builds"),&alice_session,json!({"transition":"stop"})).await.0,StatusCode::FORBIDDEN);
        // A role cannot name a resource in another organization, nor cross an org boundary.
        assert_eq!(f.call(Method::PUT,&role_path,&owner,json!({"name":"bad","permissions":[{"action":"workspace.read","resource_id":Uuid::new_v4(),"allow":true}]})).await.0,StatusCode::BAD_REQUEST);
        let foreign=Uuid::new_v4();assert_eq!(f.call(Method::GET,&format!("/api/v2/organizations/{foreign}/roles"),&owner,Value::Null).await.0,StatusCode::FORBIDDEN);
        let page=f.http.get(format!("{}/settings/access/{org}",f.base)).header("Cookie",format!("coder_ui_session={owner}")).send().await.unwrap();
        assert_eq!(page.status(),StatusCode::OK);assert!(page.text().await.unwrap().contains("terminal-reader"));
        let login=f.http.get(format!("{}/login",f.base)).send().await.unwrap().text().await.unwrap();assert!(login.contains("Sign in with SSO"));
        let page=f.http.get(format!("{}/workspaces/{id}/terminal",f.base)).header("Cookie",format!("coder_ui_session={bob_session}")).send().await.unwrap();
        assert_eq!(page.status(),StatusCode::OK);assert!(page.headers()["content-security-policy"].to_str().unwrap().contains("script-src 'self'"));
        let body=page.text().await.unwrap();assert!(body.contains("/terminal.js"));assert!(!body.contains(&bob_session));
        let (_,disabled_registration)=f.call(Method::POST,&format!("{path}/agent"),&alice_session,json!({"ports":[22],"terminal":false})).await;
        let mut disabled_request=format!("{}/api/v2/workspaces/{id}/terminal",f.base.replace("http:","ws:")).into_client_request().unwrap();
        disabled_request.headers_mut().insert("Cookie",format!("coder_ui_session={bob_session}").parse().unwrap());disabled_request.headers_mut().insert("Origin",f.base.parse().unwrap());
        assert!(tokio_tungstenite::connect_async(disabled_request.clone()).await.is_err());assert!(disabled_registration["token"].is_string());
        // Server and agent must independently opt in. Browser cookies require exact Origin.
        let (_,registration)=f.call(Method::POST,&format!("{path}/agent"),&alice_session,json!({"ports":[22],"terminal":true})).await;
        let agent_key=registration["token"].as_str().unwrap().to_owned();
        let (no_shell_stop,no_shell_shutdown)=watch::channel(false);let base=f.base.clone();let no_shell_key=agent_key.clone();
        let no_shell=tokio::spawn(async move{coder_network::agent(&base,&no_shell_key,[22].into(),no_shell_shutdown).await.unwrap();});
        tokio::time::timeout(Duration::from_secs(10),async {loop {let (_,v)=f.call(Method::GET,&format!("{path}/agent"),&alice_session,Value::Null).await;if v["connected"]==true {break;}tokio::task::yield_now().await;}}).await.unwrap();
        let(mut disabled,_)=tokio_tungstenite::connect_async(disabled_request).await.unwrap();
        tokio::time::timeout(Duration::from_secs(5),async{while let Some(Ok(m))=disabled.next().await {match m {Message::Ping(b)=>disabled.send(Message::Pong(b)).await.unwrap(),Message::Close(_)=>break,Message::Text(_)=>panic!("Agent terminal opt-in bypassed"),_=>{}}}}).await.unwrap();
        no_shell_stop.send(true).unwrap();no_shell.await.unwrap();
        let (stop,shutdown)=watch::channel(false);let base=f.base.clone();
        let agent=tokio::spawn(async move {coder_network::agent_with_terminal(&base,&agent_key,[22].into(),Some(coder_network::TerminalConfig{shell:"/bin/sh".into(),directory:"/tmp".into()}),shutdown).await.unwrap();});f.tasks.push(agent);
        tokio::time::timeout(Duration::from_secs(10),async {loop {let (_,v)=f.call(Method::GET,&format!("{path}/agent"),&alice_session,Value::Null).await;if v["connected"]==true {break;}tokio::task::yield_now().await;}}).await.unwrap();
        let mut request=format!("{}/api/v2/workspaces/{id}/terminal",f.base.replace("http:","ws:")).into_client_request().unwrap();
        request.headers_mut().insert("Cookie",format!("coder_ui_session={bob_session}").parse().unwrap());
        request.headers_mut().insert("Origin","https://attacker.example".parse().unwrap());assert!(tokio_tungstenite::connect_async(request.clone()).await.is_err());
        request.headers_mut().insert("Origin",f.base.parse().unwrap());
        let(mut ws,_)=tokio_tungstenite::connect_async(request.clone()).await.unwrap();
        assert!(matches!(ws.next().await.unwrap().unwrap(),Message::Text(t) if t=="ready"));
        ws.send(Message::Binary(vec![1,0,33,0,101].into())).await.unwrap();
        let mut input=vec![0];input.extend_from_slice(b"stty -echo; printf '\\nPTY_%s_READY\\n' $$; stty size; printf 'TOKEN_%s_END\\n' \"${CODER_AGENT_TOKEN-unset}\"\n");ws.send(Message::Binary(input.into())).await.unwrap();
        let output=until_output(&mut ws,"TOKEN_unset_END").await;assert!(output.contains("33 101"),"{output}");
        let shell_pid=output.split("PTY_").find_map(|s|s.split_once("_READY").and_then(|(pid,_)|pid.parse::<u32>().ok())).expect("real PTY process ID");
        // Removing a binding fences an already-open terminal within the authorization interval.
        assert_eq!(f.call(Method::DELETE,&binding,&owner,Value::Null).await.0,StatusCode::NO_CONTENT);
        tokio::time::timeout(Duration::from_secs(15),async {while let Some(Ok(m))=ws.next().await {match m {Message::Ping(b)=>{let _=ws.send(Message::Pong(b)).await;},Message::Close(_)=>break,_=>{}}}}).await.expect("RBAC revocation closes PTY");
        assert!(tokio_tungstenite::connect_async(request).await.is_err());
        #[cfg(target_os="linux")]
        tokio::time::timeout(Duration::from_secs(5),async{while std::path::Path::new(&format!("/proc/{shell_pid}")).exists(){tokio::task::yield_now().await;}}).await.expect("revoked shell is killed and reaped");
        assert_eq!(f.call(Method::GET,&format!("/api/v2/organizations/{org}/audit"),&bob_session,Value::Null).await.0,StatusCode::FORBIDDEN);
        let (_,events)=f.call(Method::GET,&format!("/api/v2/organizations/{org}/audit"),&owner,Value::Null).await;assert!(events.as_array().unwrap().iter().any(|e|e["action"]=="terminal.open"));
        stop.send(true).unwrap();
        assert_eq!(f.call(Method::PUT,&format!("/api/v2/organizations/{org}/oidc/users/{bob}"),&owner,json!({"subject":"subject-2"})).await.0,StatusCode::NO_CONTENT);
        assert_eq!(f.call(Method::GET,"/api/v2/users/me",&bob_session,Value::Null).await.0,StatusCode::UNAUTHORIZED);
        let (url,cookie)=f.flow(&idp,"linked").await;
        let linked=f.http.get(url).header("Cookie",cookie).send().await.unwrap();assert_eq!(linked.status(),StatusCode::SEE_OTHER);
        let linked_cookie=linked.headers().get_all("set-cookie").iter().find_map(|h|h.to_str().ok().filter(|v|v.starts_with("coder_ui_session="))).unwrap();
        let linked_token=linked_cookie.split(';').next().unwrap().split_once('=').unwrap().1;
        let (_,linked_user)=f.call(Method::GET,"/api/v2/users/me",linked_token,Value::Null).await;assert_eq!(linked_user["id"],bob.to_string());
        assert_eq!(f.call(Method::PUT,&format!("/api/v2/organizations/{org}/oidc/users/{bob}"),&owner,json!({"subject":"subject-3"})).await.0,StatusCode::NO_CONTENT);
        let (url,cookie)=f.flow(&idp,"linked").await;
        assert_eq!(f.http.get(url).header("Cookie",cookie).send().await.unwrap().status(),StatusCode::UNAUTHORIZED,"old subject removed on relink");
    }).await.expect("Access integration deadline");
}
