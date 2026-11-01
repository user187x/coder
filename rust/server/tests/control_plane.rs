//! End-to-end persistence, authorization, job fencing, and Rust UI integration.
//!
//! Run against an empty dedicated database with:
//! `CODER_TEST_DATABASE_URL=... cargo test -p coder-server --test control_plane -- --ignored`

use reqwest::{Client, Method, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

struct Server {
    base: String,
    client: Client,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl Server {
    async fn start(pool: PgPool) -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let app = coder_server::api(pool, Some([17; 32]))
            .merge(coder_ui::integrated_router(&base, &base).unwrap());
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        Self {
            base,
            client: Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap(),
            task,
        }
    }
    async fn call(
        &self,
        method: Method,
        path: &str,
        token: &str,
        worker: bool,
        body: Value,
    ) -> (StatusCode, Value) {
        let mut request = self.client.request(method, format!("{}{path}", self.base));
        if !token.is_empty() {
            request = request.header(
                if worker {
                    "Coder-Provisioner-Token"
                } else {
                    "Coder-Session-Token"
                },
                token,
            );
        }
        let response = request.json(&body).send().await.unwrap();
        let status = response.status();
        let bytes = response.bytes().await.unwrap();
        let body = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes)
                .unwrap_or_else(|_| panic!("Unexpected body: {}", String::from_utf8_lossy(&bytes)))
        };
        (status, body)
    }
    async fn login(&self, email: &str) -> String {
        let (status, body) = self
            .call(
                Method::POST,
                "/api/v2/users/login",
                "",
                false,
                json!({"email":email,"password":"long-test-password"}),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        body["session_token"].as_str().unwrap().into()
    }
}

#[tokio::test]
#[ignore = "requires an empty dedicated PostgreSQL database in CODER_TEST_DATABASE_URL"]
async fn control_plane_and_rust_ui_work_without_the_go_server() {
    let url=std::env::var("CODER_TEST_DATABASE_URL").expect("Set CODER_TEST_DATABASE_URL to an empty test database; this test never resets existing data");
    let pool = if std::env::var_os("CODER_TEST_SINGLE_CONNECTION").is_some() {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .unwrap();
        coder_server::migrate(&pool)
            .await
            .expect("Migrate embedded PostgreSQL");
        pool
    } else {
        coder_server::connect(&url)
            .await
            .expect("Connect and migrate PostgreSQL")
    };
    let server = Server::start(pool.clone()).await;
    let setup = server
        .client
        .get(format!("{}/setup", server.base))
        .send()
        .await
        .unwrap();
    assert_eq!(setup.status(), StatusCode::OK);
    assert!(
        setup
            .text()
            .await
            .unwrap()
            .contains("Create your first account")
    );
    let(status,first)=server.call(Method::POST,"/api/v2/users/first","",false,json!({"username":"owner","email":"owner@example.test","name":"Owner","password":"long-test-password"})).await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "Use a fresh dedicated database. {first}"
    );
    let org = first["organization_id"].as_str().unwrap();
    let owner = server.login("owner").await;
    assert_eq!(server.call(Method::POST,"/api/v2/users/first","",false,json!({"username":"second","email":"second@example.test","password":"long-test-password"})).await.0,StatusCode::CONFLICT);
    assert_eq!(
        server
            .call(Method::GET, "/api/v2/workspaces", "", false, Value::Null)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        server
            .call(
                Method::POST,
                "/api/v2/users/login",
                "",
                false,
                json!({"email":"owner","password":"incorrect-password"})
            )
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );

    let(status,member)=server.call(Method::POST,"/api/v2/users",&owner,false,json!({"username":"member","email":"member@example.test","password":"long-test-password","organization_ids":[org]})).await;
    assert_eq!(status, StatusCode::CREATED, "{member}");
    let member_token = server.login("member").await;
    assert_eq!(
        server
            .call(
                Method::GET,
                "/api/v2/users",
                &member_token,
                false,
                Value::Null
            )
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let(status,template)=server.call(Method::POST,&format!("/api/v2/organizations/{org}/templates"),&owner,false,
        json!({"name":"development","display_name":"Development","parameters":[{"name":"cores","type":"number","default_value":"2","required":true}],"provisioner_spec":{"driver":"test-worker"}})).await;
    assert_eq!(status, StatusCode::CREATED, "{template}");
    let version = template["active_version_id"].as_str().unwrap();
    let (status, key) = server
        .call(
            Method::POST,
            &format!("/api/v2/organizations/{org}/provisionerkeys"),
            &owner,
            false,
            json!({}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let key = key["key"].as_str().unwrap().to_owned();
    let (status, secret) = server
        .call(
            Method::POST,
            "/api/v2/users/me/secrets",
            &owner,
            false,
            json!({"name":"api-key","value":"private-worker-secret","env_name":"API_KEY"}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{secret}");
    assert!(!secret.to_string().contains("private-worker-secret"));
    let stored: Vec<u8> =
        sqlx::query_scalar("SELECT ciphertext FROM coder_rust.secrets WHERE name='api-key'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(
        !stored
            .windows(b"private-worker-secret".len())
            .any(|s| s == b"private-worker-secret")
    );

    let create = json!({"name":"my-workspace","template_version_id":version,"rich_parameter_values":[{"name":"cores","value":"4"}]});
    let (status, w) = server
        .call(
            Method::POST,
            "/api/v2/users/me/workspaces",
            &owner,
            false,
            create,
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{w}");
    assert_eq!(w["latest_build"]["status"], "pending");
    let workspace = w["id"].as_str().unwrap();
    let first_build = w["latest_build"]["id"].as_str().unwrap();
    for path in [
        "/api/v2/users/me/workspace/my-workspace".to_owned(),
        "/api/v2/users/OWNER/workspace/MY-WORKSPACE".to_owned(),
        format!(
            "/api/v2/users/{}/workspace/my-workspace",
            first["user_id"].as_str().unwrap()
        ),
        "/api/v2/users/owner/workspace/my-workspace/builds/1".to_owned(),
        format!("/api/v2/workspacebuilds/{first_build}"),
        format!("/api/v2/workspacebuilds/{first_build}/parameters"),
        format!("/api/v2/workspacebuilds/{first_build}/resources"),
    ] {
        let (status, body) = server
            .call(Method::GET, &path, &owner, false, Value::Null)
            .await;
        assert_eq!(status, StatusCode::OK, "{path}: {body}");
        if path.ends_with("parameters") {
            assert_eq!(body, json!([{"name":"cores","value":"4"}]));
        }
        // 'me' denotes a different owner for this user, so the name lookup is absent.
        let denied = server
            .call(Method::GET, &path, &member_token, false, Value::Null)
            .await
            .0;
        assert!(
            matches!(denied, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND),
            "{path}: {denied}"
        );
        assert_eq!(
            server
                .call(Method::GET, &path, "", false, Value::Null)
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
    }
    for (q, count) in [
        ("user:me".to_owned(), 1),
        (
            "owner:OWNER template:DEVELOPMENT status:pending outdated:false".to_owned(),
            1,
        ),
        ("owner/my-workspace".to_owned(), 1),
        (format!("organization:{org} id:{workspace}"), 1),
        (r#"name:"my-workspace""#.to_owned(), 1),
        ("outdated:true".to_owned(), 0),
        ("owner:member".to_owned(), 0),
        ("status:running".to_owned(), 0),
    ] {
        let url = reqwest::Url::parse_with_params(
            &format!("{}/api/v2/workspaces", server.base),
            [("q", &q)],
        )
        .unwrap();
        let response: Value = server
            .client
            .get(url.clone())
            .header("Coder-Session-Token", &owner)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(response["count"], count, "{q}: {response}");
        assert_eq!(
            response["workspaces"].as_array().unwrap().len(),
            count as usize
        );
        let response: Value = server
            .client
            .get(url)
            .header("Coder-Session-Token", &member_token)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(
            response["count"], 0,
            "Filters must not bypass authorization: {q}"
        );
    }
    let response: Value = server
        .client
        .get(format!("{}/api/v2/workspaces?offset=50", server.base))
        .header("Coder-Session-Token", &owner)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(response["count"], 1);
    assert_eq!(response["workspaces"], json!([]));
    for q in [
        "outdated:garbage",
        "status:unknown",
        "owner:me owner:member",
        "has-agent:connected",
    ] {
        let url = reqwest::Url::parse_with_params(
            &format!("{}/api/v2/workspaces", server.base),
            [("q", q)],
        )
        .unwrap();
        assert_eq!(
            server
                .client
                .get(url)
                .header("Coder-Session-Token", &owner)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
    }

    let other_org = Uuid::new_v4();
    sqlx::query("INSERT INTO coder_rust.organizations VALUES($1,'isolated','Isolated')")
        .bind(other_org)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO coder_rust.memberships VALUES($1,$2)")
        .bind(other_org)
        .bind(Uuid::parse_str(first["user_id"].as_str().unwrap()).unwrap())
        .execute(&pool)
        .await
        .unwrap();
    let (_, other_key) = server
        .call(
            Method::POST,
            &format!("/api/v2/organizations/{other_org}/provisionerkeys"),
            &owner,
            false,
            json!({}),
        )
        .await;
    let (_, no_job) = server
        .call(
            Method::POST,
            "/api/v2/provisioner/jobs/claim",
            other_key["key"].as_str().unwrap(),
            true,
            json!({}),
        )
        .await;
    assert!(
        no_job.is_null(),
        "Workers must not claim another organization's jobs"
    );
    assert_eq!(
        server
            .call(
                Method::GET,
                &format!("/api/v2/workspaces/{workspace}"),
                &member_token,
                false,
                Value::Null
            )
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        server
            .call(
                Method::POST,
                &format!("/api/v2/workspaces/{workspace}/builds"),
                &owner,
                false,
                json!({"transition":"start"})
            )
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        server
            .call(
                Method::POST,
                "/api/v2/provisioner/jobs/claim",
                &owner,
                true,
                json!({})
            )
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let (status, job) = server
        .call(
            Method::POST,
            "/api/v2/provisioner/jobs/claim",
            &key,
            true,
            json!({}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{job}");
    assert_eq!(job["environment"]["API_KEY"], "private-worker-secret");
    assert_eq!(job["parameters"][0]["value"], "4");
    let build = job["id"].as_str().unwrap();
    let lease = job["lease_token"].as_str().unwrap();
    assert_eq!(
        server
            .call(
                Method::POST,
                &format!("/api/v2/provisioner/jobs/{build}/complete"),
                &key,
                true,
                json!({"lease_token":"wrong","success":true})
            )
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        server
            .call(
                Method::POST,
                &format!("/api/v2/provisioner/jobs/{build}/heartbeat"),
                &key,
                true,
                json!({"lease_token":lease})
            )
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(server.call(Method::POST,&format!("/api/v2/provisioner/jobs/{build}/logs"),&key,true,json!({"lease_token":lease,"entries":[{"log_level":"info","output":"Infrastructure created by test worker"}]})).await.0,StatusCode::OK);
    let complete = json!({"lease_token":lease,"success":true,"resources":[{"name":"actual-test-resource","type":"container","hide":false,"agents":[]}]});
    assert_eq!(
        server
            .call(
                Method::POST,
                &format!("/api/v2/provisioner/jobs/{build}/complete"),
                &key,
                true,
                complete.clone()
            )
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        server
            .call(
                Method::POST,
                &format!("/api/v2/provisioner/jobs/{build}/complete"),
                &key,
                true,
                complete
            )
            .await
            .0,
        StatusCode::CONFLICT
    );
    let (_, running) = server
        .call(
            Method::GET,
            &format!("/api/v2/workspaces/{workspace}"),
            &owner,
            false,
            Value::Null,
        )
        .await;
    assert_eq!(running["latest_build"]["status"], "running");
    assert_eq!(
        running["latest_build"]["resources"][0]["name"],
        "actual-test-resource"
    );

    // Restart the HTTP application; sessions and workspace state remain durable.
    drop(server);
    let server = Server::start(pool.clone()).await;
    let (_, persisted) = server
        .call(
            Method::GET,
            &format!("/api/v2/workspaces/{workspace}"),
            &owner,
            false,
            Value::Null,
        )
        .await;
    assert_eq!(persisted["latest_build"]["status"], "running");
    let response = server
        .client
        .post(format!("{}/login", server.base))
        .header("Origin", &server.base)
        .form(&[
            ("method", "password"),
            ("email", "owner"),
            ("password", "long-test-password"),
        ])
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    let cookie = response.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let html = server
        .client
        .get(format!("{}/workspaces", server.base))
        .header("Cookie", cookie)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(html.contains("my-workspace"));

    let (status, _) = server
        .call(
            Method::POST,
            &format!("/api/v2/workspaces/{workspace}/builds"),
            &owner,
            false,
            json!({"transition":"stop","on_success":{"transition":"start"}}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let (_, stop) = server
        .call(
            Method::POST,
            "/api/v2/provisioner/jobs/claim",
            &key,
            true,
            json!({}),
        )
        .await;
    assert_eq!(stop["transition"], "stop");
    assert_eq!(
        server
            .call(
                Method::POST,
                &format!(
                    "/api/v2/provisioner/jobs/{}/complete",
                    stop["id"].as_str().unwrap()
                ),
                &key,
                true,
                json!({"lease_token":stop["lease_token"],"success":true})
            )
            .await
            .0,
        StatusCode::OK
    );
    let (_, restart) = server
        .call(
            Method::POST,
            "/api/v2/provisioner/jobs/claim",
            &key,
            true,
            json!({}),
        )
        .await;
    assert_eq!(restart["transition"], "start");
    let restart_id = restart["id"].as_str().unwrap();
    assert_eq!(
        server
            .call(
                Method::PATCH,
                &format!("/api/v2/workspacebuilds/{restart_id}/cancel"),
                &owner,
                false,
                json!({})
            )
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        server
            .call(
                Method::POST,
                &format!("/api/v2/provisioner/jobs/{restart_id}/complete"),
                &key,
                true,
                json!({"lease_token":restart["lease_token"],"success":true})
            )
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        server
            .call(
                Method::POST,
                &format!("/api/v2/workspaces/{workspace}/builds"),
                &owner,
                false,
                json!({"transition":"start"})
            )
            .await
            .0,
        StatusCode::CREATED
    );
    let (_, expiring) = server
        .call(
            Method::POST,
            "/api/v2/provisioner/jobs/claim",
            &key,
            true,
            json!({}),
        )
        .await;
    let expired_id = Uuid::parse_str(expiring["id"].as_str().unwrap()).unwrap();
    sqlx::query(
        "UPDATE coder_rust.builds SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
    )
    .bind(expired_id)
    .execute(&pool)
    .await
    .unwrap();
    let (_, retry) = server
        .call(
            Method::POST,
            "/api/v2/provisioner/jobs/claim",
            &key,
            true,
            json!({}),
        )
        .await;
    assert!(
        retry.is_null(),
        "Expired jobs must not automatically repeat infrastructure changes"
    );
    let (_, failed) = server
        .call(
            Method::GET,
            &format!("/api/v2/workspaces/{workspace}"),
            &owner,
            false,
            Value::Null,
        )
        .await;
    assert_eq!(failed["latest_build"]["status"], "failed");
    assert_eq!(
        server
            .call(
                Method::POST,
                &format!("/api/v2/workspaces/{workspace}/builds"),
                &owner,
                false,
                json!({"transition":"delete"})
            )
            .await
            .0,
        StatusCode::CREATED
    );
    let (_, delete) = server
        .call(
            Method::POST,
            "/api/v2/provisioner/jobs/claim",
            &key,
            true,
            json!({}),
        )
        .await;
    assert_eq!(
        server
            .call(
                Method::POST,
                &format!(
                    "/api/v2/provisioner/jobs/{}/complete",
                    delete["id"].as_str().unwrap()
                ),
                &key,
                true,
                json!({"lease_token":delete["lease_token"],"success":true})
            )
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        server
            .call(
                Method::GET,
                &format!("/api/v2/workspaces/{workspace}"),
                &owner,
                false,
                Value::Null
            )
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        server
            .call(
                Method::POST,
                "/api/v2/users/logout",
                &owner,
                false,
                json!({})
            )
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        server
            .call(Method::GET, "/api/v2/users/me", &owner, false, Value::Null)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let session_hashes: Vec<String> =
        sqlx::query_scalar("SELECT token_hash FROM coder_rust.sessions")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert!(!session_hashes.contains(&member_token));
    assert!(Uuid::parse_str(member["id"].as_str().unwrap()).is_ok());
}
