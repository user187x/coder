//! PostgreSQL scheduling, quota admission, policy enforcement and Rust forms.
use chrono::{Duration, Utc};
use reqwest::{Client, Method, StatusCode};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
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
        let router = coder_server::api(pool, Some([13; 32]))
            .merge(coder_ui::integrated_router(&base, &base).unwrap());
        let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
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
        session: &str,
        body: Value,
    ) -> (StatusCode, Value) {
        let r = self
            .client
            .request(method, format!("{}{path}", self.base))
            .header("Coder-Session-Token", session)
            .json(&body)
            .send()
            .await
            .unwrap();
        let status = r.status();
        let bytes = r.bytes().await.unwrap();
        (
            status,
            if bytes.is_empty() {
                Value::Null
            } else {
                serde_json::from_slice(&bytes).unwrap()
            },
        )
    }
    async fn create(
        &self,
        session: &str,
        template: &Value,
        name: &str,
        extra: Value,
    ) -> (StatusCode, Value) {
        let mut body = json!({"name":name,"template_id":template["id"]});
        body.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        self.call(Method::POST, "/api/v2/users/me/workspaces", session, body)
            .await
    }
    async fn complete(&self, worker: &str) -> Value {
        let job: Value = self
            .client
            .post(format!("{}/api/v2/provisioner/jobs/claim", self.base))
            .header("Coder-Provisioner-Token", worker)
            .json(&json!({}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert!(job["id"].is_string(), "{job}");
        let r = self
            .client
            .post(format!(
                "{}/api/v2/provisioner/jobs/{}/complete",
                self.base,
                job["id"].as_str().unwrap()
            ))
            .header("Coder-Provisioner-Token", worker)
            .json(&json!({"lease_token":job["lease_token"],"success":true,"resources":[]}))
            .send()
            .await
            .unwrap();
        let status = r.status();
        let body = r.text().await.unwrap();
        assert_eq!(status, StatusCode::OK, "{body}");
        job
    }
    async fn transition(&self, session: &str, id: &str, transition: &str) -> Value {
        let (status, body) = self
            .call(
                Method::POST,
                &format!("/api/v2/workspaces/{id}/builds"),
                session,
                json!({"transition":transition}),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        body
    }
}
async fn user(pool: &PgPool, org: Uuid, admin: bool) -> (Uuid, String, String) {
    let id = Uuid::new_v4();
    let name = format!("life-{}", &id.simple().to_string()[..10]);
    let token = Uuid::new_v4().simple().to_string();
    let hash = Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    sqlx::query("INSERT INTO coder_rust.users(id,username,email,password_hash,is_admin) VALUES($1,$2,$3,'!', $4)").bind(id).bind(&name).bind(format!("{name}@example.test")).bind(admin).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO coder_rust.memberships VALUES($1,$2)")
        .bind(org)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO coder_rust.sessions VALUES($1,$2,now()+interval '1 hour')")
        .bind(hash)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    (id, name, token)
}

#[tokio::test]
#[ignore = "Requires a dedicated PostgreSQL database"]
async fn quotas_and_schedules_survive_restarts_and_enforce_permissions() {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(
            if std::env::var_os("CODER_TEST_SINGLE_CONNECTION").is_some() {
                1
            } else {
                10
            },
        )
        .connect(&std::env::var("CODER_TEST_DATABASE_URL").expect("dedicated database required"))
        .await
        .unwrap();
    coder_server::migrate(&pool).await.unwrap();
    let org = Uuid::new_v4();
    sqlx::query("INSERT INTO coder_rust.organizations VALUES($1,$2,'Lifecycle')")
        .bind(org)
        .bind(format!("life-{org}"))
        .execute(&pool)
        .await
        .unwrap();
    let (_, _, admin) = user(&pool, org, true).await;
    let (alice_id, alice_name, alice) = user(&pool, org, false).await;
    let (_, bob_name, bob) = user(&pool, org, false).await;
    let server = Server::start(pool.clone()).await;
    assert_eq!(
        server
            .call(
                Method::POST,
                "/api/v2/deployment/scheduler",
                &admin,
                json!({})
            )
            .await
            .0,
        StatusCode::OK
    );
    let limits = json!({"default":{"workspaces":2,"cpu":4,"memory":8,"disk":50}});
    assert_eq!(
        server
            .call(
                Method::POST,
                "/api/v2/deployment/quota",
                &admin,
                limits.clone()
            )
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        server
            .call(
                Method::POST,
                "/api/v2/deployment/quota",
                &alice,
                limits.clone()
            )
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let (status,template)=server.call(Method::POST,&format!("/api/v2/organizations/{org}/templates"),&admin,json!({"name":"lifecycle","parameters":[{"name":"cpu","type":"number","default_value":"1"},{"name":"memory","type":"number","default_value":"2"},{"name":"home_disk_size","type":"number","default_value":"10"}],"provisioner_spec":{"driver":"test"}})).await;
    assert_eq!(status, StatusCode::CREATED, "{template}");
    let (_, key) = server
        .call(
            Method::POST,
            &format!("/api/v2/organizations/{org}/provisionerkeys"),
            &admin,
            json!({}),
        )
        .await;
    let worker = key["key"].as_str().unwrap();
    let (a, b, c) = tokio::join!(
        server.create(&alice, &template, "one", json!({})),
        server.create(&alice, &template, "two", json!({})),
        server.create(&alice, &template, "three", json!({}))
    );
    let results = [a, b, c];
    assert_eq!(
        results
            .iter()
            .filter(|r| r.0 == StatusCode::CREATED)
            .count(),
        2,
        "{results:?}"
    );
    assert_eq!(
        results
            .iter()
            .filter(|r| r.0 == StatusCode::FORBIDDEN)
            .count(),
        1
    );
    let w = &results
        .iter()
        .find(|r| r.0 == StatusCode::CREATED)
        .unwrap()
        .1;
    let id = w["id"].as_str().unwrap();
    let uuid = Uuid::parse_str(id).unwrap();
    server.complete(worker).await;
    server.complete(worker).await;
    let (_, usage) = server
        .call(Method::GET, "/api/v2/users/me/quota", &alice, Value::Null)
        .await;
    assert_eq!(usage["usage"]["workspaces"], 2.0);
    assert_eq!(usage["usage"]["disk"], 20.0);
    assert_eq!(
        server
            .call(
                Method::POST,
                "/api/v2/deployment/quota",
                &admin,
                json!({"default":{"workspaces":1,"cpu":1}})
            )
            .await
            .0,
        StatusCode::OK
    );
    server.transition(&alice, id, "stop").await;
    server.complete(worker).await;
    assert_eq!(
        server
            .call(
                Method::POST,
                &format!("/api/v2/workspaces/{id}/builds"),
                &alice,
                json!({"transition":"start","rich_parameter_values":[{"name":"cpu","value":"9"}]})
            )
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    server.transition(&alice, id, "start").await;
    server.complete(worker).await;
    // Explicit unlimited overrides differ from omitted/inherited limits.
    assert_eq!(server.call(Method::POST,"/api/v2/deployment/quota",&admin,json!({"default":{"cpu":2},"users":{alice_name.clone():{"cpu":null}},"resourceModes":{"cpu":"instance"}})).await.0,StatusCode::OK);
    let (_, usage) = server
        .call(Method::GET, "/api/v2/users/me/quota", &alice, Value::Null)
        .await;
    assert!(usage["limits"]["cpu"].is_null());
    assert_eq!(
        server
            .create(
                &bob,
                &template,
                "too-large",
                json!({"rich_parameter_values":[{"name":"cpu","value":"3"}]})
            )
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        server
            .call(
                Method::PUT,
                &format!("/api/v2/workspaces/{id}/ttl"),
                &bob,
                json!({"ttl_ms":60000})
            )
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let path = format!("/api/v2/workspaces/{id}/schedule");
    assert_eq!(
        server
            .call(
                Method::PUT,
                &path,
                &alice,
                json!({"autostart_schedule":"CRON_TZ=UTC */5 * * * *","ttl_ms":60000})
            )
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        server
            .call(
                Method::PUT,
                &format!("/api/v2/workspaces/{id}/autostart"),
                &alice,
                json!({"schedule":"CRON_TZ=Nowhere/Invalid 0 9 * * *"})
            )
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    server.transition(&alice, id, "stop").await;
    server.complete(worker).await;
    server.transition(&alice, id, "start").await;
    server.complete(worker).await;
    let (_, live) = server
        .call(
            Method::GET,
            &format!("/api/v2/workspaces/{id}"),
            &alice,
            Value::Null,
        )
        .await;
    assert!(live["latest_build"]["deadline"].is_string());
    assert_eq!(
        server
            .call(
                Method::PUT,
                &format!("/api/v2/workspaces/{id}/extend"),
                &alice,
                json!({"deadline":Utc::now()+Duration::hours(2)})
            )
            .await
            .0,
        StatusCode::OK
    );
    // A fresh HTTP process sees persisted policies and deadlines.
    let restarted = Server::start(pool.clone()).await;
    let (_, persisted) = restarted
        .call(
            Method::GET,
            &format!("/api/v2/workspaces/{id}"),
            &alice,
            Value::Null,
        )
        .await;
    assert_eq!(persisted["ttl_ms"], 60000);
    sqlx::query("UPDATE coder_rust.builds SET deadline=now()-interval '1 second' WHERE id=(SELECT latest_build_id FROM coder_rust.workspaces WHERE id=$1)").bind(uuid).execute(&pool).await.unwrap();
    let (x, y) = tokio::join!(
        coder_server::reconcile_schedules(&pool),
        coder_server::reconcile_schedules(&pool)
    );
    assert_eq!(x.unwrap() + y.unwrap(), 1);
    let job = server.complete(worker).await;
    assert_eq!(job["transition"], "stop");
    let (_, stopped) = server
        .call(
            Method::GET,
            &format!("/api/v2/workspaces/{id}"),
            &alice,
            Value::Null,
        )
        .await;
    assert_eq!(stopped["latest_build"]["reason"], "autostop");
    sqlx::query(
        "UPDATE coder_rust.workspaces SET next_start_at=now()-interval '1 minute' WHERE id=$1",
    )
    .bind(uuid)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE coder_rust.users SET status='suspended' WHERE id=$1")
        .bind(alice_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(coder_server::reconcile_schedules(&pool).await.unwrap(), 0);
    sqlx::query("UPDATE coder_rust.users SET status='active' WHERE id=$1")
        .bind(alice_id)
        .execute(&pool)
        .await
        .unwrap();
    let role = Uuid::new_v4();
    let role_path = format!("/api/v2/organizations/{org}/roles/{role}");
    assert_eq!(server.call(Method::PUT,&role_path,&admin,json!({"name":"deny-autostart","permissions":[{"action":"workspace.start","resource_id":uuid,"allow":false}]})).await.0,StatusCode::OK);
    assert_eq!(
        server
            .call(
                Method::PUT,
                &format!("{role_path}/users/{alice_id}"),
                &admin,
                json!({})
            )
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    sqlx::query(
        "UPDATE coder_rust.workspaces SET next_start_at=now()-interval '1 minute' WHERE id=$1",
    )
    .bind(uuid)
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(coder_server::reconcile_schedules(&pool).await.unwrap(), 0);
    assert_eq!(
        server
            .call(Method::DELETE, &role_path, &admin, Value::Null)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    sqlx::query(
        "UPDATE coder_rust.workspaces SET next_start_at=now()-interval '1 minute' WHERE id=$1",
    )
    .bind(uuid)
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(coder_server::reconcile_schedules(&pool).await.unwrap(), 1);
    let job = server.complete(worker).await;
    assert_eq!(job["transition"], "start");
    assert_eq!(coder_server::reconcile_schedules(&pool).await.unwrap(), 0);
    // Fixed global schedules apply on create, respect exclusions and cap extensions.
    assert_eq!(
        server
            .call(Method::POST, "/api/v2/deployment/quota", &admin, json!({}))
            .await
            .0,
        StatusCode::OK
    );
    let policy = json!({"enabled":true,"mode":"fixed","fixed":{"start":"09:00","stop":"17:00","days":[1,2,3,4,5],"timezone":"UTC"},"maxActiveHours":8,"ignoreAdmins":false,"excludedUsers":[bob_name]});
    assert_eq!(
        server
            .call(Method::POST, "/api/v2/deployment/scheduler", &admin, policy)
            .await
            .0,
        StatusCode::OK
    );
    let (status, fixed) = server.create(&admin, &template, "fixed", json!({})).await;
    assert_eq!(status, StatusCode::CREATED, "{fixed}");
    assert_eq!(fixed["ttl_ms"], 28800000);
    assert_eq!(fixed["autostart_schedule"], "CRON_TZ=UTC 0 9 * * 1,2,3,4,5");
    server.complete(worker).await;
    assert_eq!(
        server
            .call(
                Method::PUT,
                &format!(
                    "/api/v2/workspaces/{}/extend",
                    fixed["id"].as_str().unwrap()
                ),
                &admin,
                json!({"deadline":Utc::now()+Duration::hours(9)})
            )
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    let (status, exempt) = server.create(&bob, &template, "exempt", json!({})).await;
    assert_eq!(status, StatusCode::CREATED, "{exempt}");
    assert!(exempt["ttl_ms"].is_null());
    server.complete(worker).await;
    assert_eq!(
        server
            .call(
                Method::PUT,
                &format!("/api/v2/workspaces/{id}/ttl"),
                &alice,
                json!({"ttl_ms":60000})
            )
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let policy = json!({"enabled":true,"mode":"user","maxActiveHours":1,"ignoreAdmins":false});
    assert_eq!(
        server
            .call(Method::POST, "/api/v2/deployment/scheduler", &admin, policy)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        server
            .create(&alice, &template, "missing-schedule", json!({}))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        server
            .create(
                &alice,
                &template,
                "too-long",
                json!({"autostart_schedule":"0 9 * * MON-FRI","ttl_ms":7200000})
            )
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    // Rust UI submissions carry parameters as integers and enforce Origin.
    let page = format!("/workspaces/{id}/settings/schedule");
    let cookie = format!("coder_ui_session={alice}");
    let r = server
        .client
        .get(format!("{}{page}", server.base))
        .header("Cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    assert!(r.text().await.unwrap().contains("Automatic start"));
    let fields = [
        ("autostart_schedule", "CRON_TZ=UTC 0 9 * * MON-FRI"),
        ("ttl_minutes", "30"),
    ];
    assert_eq!(
        server
            .client
            .post(format!("{}{page}", server.base))
            .header("Cookie", &cookie)
            .form(&fields)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        server
            .client
            .post(format!("{}{page}", server.base))
            .header("Cookie", &cookie)
            .header("Origin", &server.base)
            .form(&fields)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::SEE_OTHER
    );
    let (_, updated) = server
        .call(
            Method::GET,
            &format!("/api/v2/workspaces/{id}"),
            &alice,
            Value::Null,
        )
        .await;
    assert_eq!(updated["ttl_ms"], 1800000);
    assert_eq!(
        server
            .client
            .get(format!("{}/health/user-quota", server.base))
            .header("Cookie", &cookie)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let r = server
        .client
        .get(format!("{}/health/user-quota", server.base))
        .header("Cookie", format!("coder_ui_session={admin}"))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    assert!(
        r.text()
            .await
            .unwrap()
            .contains("Global Workspace Scheduler")
    );
    // Leave deployment policy neutral for the other suites sharing this test DB.
    assert_eq!(
        server
            .call(
                Method::POST,
                "/api/v2/deployment/scheduler",
                &admin,
                json!({})
            )
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        server
            .call(Method::POST, "/api/v2/deployment/quota", &admin, json!({}))
            .await
            .0,
        StatusCode::OK
    );
    // Immutable template versions, active-version policy and parameter migration.
    let tid = template["id"].as_str().unwrap();
    let original = template["active_version_id"].as_str().unwrap();
    let request = json!({"template_id":tid,"name":"v2","message":"new parameter schema","parameters":[{"name":"cpu","type":"number","default_value":"3"},{"name":"memory","type":"number","default_value":"4"},{"name":"new-field","type":"string","default_value":"ready"}],"provisioner_spec":{"driver":"test"}});
    let version_path = format!("/api/v2/organizations/{org}/templateversions");
    assert_eq!(
        server
            .call(Method::POST, &version_path, &alice, request.clone())
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let (status, v2) = server
        .call(Method::POST, &version_path, &admin, request)
        .await;
    assert_eq!(status, StatusCode::CREATED, "{v2}");
    assert_eq!(
        server
            .call(
                Method::POST,
                &format!("/api/v2/templateversions/{original}/archive"),
                &admin,
                json!({})
            )
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        server
            .call(
                Method::PATCH,
                &format!("/api/v2/templates/{tid}/versions"),
                &admin,
                json!({"id":v2["id"]})
            )
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        server
            .call(
                Method::PATCH,
                &format!("/api/v2/templates/{tid}"),
                &admin,
                json!({"default_ttl_ms":60000,"require_active_version":true})
            )
            .await
            .0,
        StatusCode::OK
    );
    let (_, outdated) = server
        .call(
            Method::GET,
            &format!("/api/v2/workspaces/{id}"),
            &alice,
            Value::Null,
        )
        .await;
    assert_eq!(outdated["outdated"], true);
    server.transition(&alice, id, "stop").await;
    server.complete(worker).await;
    assert_eq!(
        server
            .call(
                Method::POST,
                &format!("/api/v2/workspaces/{id}/builds"),
                &alice,
                json!({"transition":"start","template_version_id":original})
            )
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    server.transition(&alice, id, "start").await;
    let job = server.complete(worker).await;
    assert_eq!(job["template_version_id"], v2["id"]);
    let params = job["parameters"].as_array().unwrap();
    assert!(
        params.contains(&json!({"name":"cpu","value":"1"})),
        "Unchanged parameters must survive version updates"
    );
    assert!(params.contains(&json!({"name":"new-field","value":"ready"})));
    assert!(!params.iter().any(|p| p["name"] == "home_disk_size"));
    assert_eq!(
        server
            .call(
                Method::POST,
                "/api/v2/users/me/workspaces",
                &alice,
                json!({"name":"stale-create","template_version_id":original})
            )
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    let (status, defaulted) = server
        .create(
            &bob,
            &template,
            "default-ttl",
            json!({"automatic_updates":"always"}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{defaulted}");
    assert_eq!(defaulted["ttl_ms"], 60000);
    assert_eq!(defaulted["automatic_updates"], "always");
    server.complete(worker).await;
    let request =
        json!({"template_id":tid,"name":"v3","parameters":[],"provisioner_spec":{"driver":"test"}});
    let (_, v3) = server
        .call(Method::POST, &version_path, &admin, request)
        .await;
    let v3id = v3["id"].as_str().unwrap();
    assert_eq!(
        server
            .call(
                Method::POST,
                &format!("/api/v2/templateversions/{v3id}/archive"),
                &admin,
                json!({})
            )
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        server
            .call(
                Method::PATCH,
                &format!("/api/v2/templates/{tid}/versions"),
                &admin,
                json!({"id":v3id})
            )
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        server
            .call(
                Method::POST,
                &format!("/api/v2/templateversions/{v3id}/unarchive"),
                &admin,
                json!({})
            )
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        server
            .call(
                Method::DELETE,
                &format!("/api/v2/templates/{tid}"),
                &admin,
                Value::Null
            )
            .await
            .0,
        StatusCode::CONFLICT
    );
    let (_, unused) = server
        .call(
            Method::POST,
            &format!("/api/v2/organizations/{org}/templates"),
            &admin,
            json!({"name":"unused","provisioner_spec":{"driver":"test"}}),
        )
        .await;
    let unused_id = unused["id"].as_str().unwrap();
    assert_eq!(
        server
            .call(
                Method::PATCH,
                &format!("/api/v2/templates/{tid}/versions"),
                &admin,
                json!({"id":unused["active_version_id"]})
            )
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        server
            .call(
                Method::PATCH,
                &format!("/api/v2/templates/{unused_id}"),
                &admin,
                json!({"deprecation_message":"Replaced"})
            )
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        server
            .create(&bob, &unused, "deprecated", json!({}))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        server
            .call(
                Method::DELETE,
                &format!("/api/v2/templates/{unused_id}"),
                &admin,
                Value::Null
            )
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        server
            .call(
                Method::GET,
                &format!("/api/v2/templates/{unused_id}"),
                &admin,
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
                &format!("/api/v2/organizations/{org}/templates"),
                &admin,
                json!({"name":"unused","provisioner_spec":{"driver":"test"}})
            )
            .await
            .0,
        StatusCode::CREATED
    );
    assert_eq!(
        server
            .call(
                Method::POST,
                &format!("/api/v2/organizations/{org}/templates"),
                &admin,
                json!({"name":"UNUSED","provisioner_spec":{"driver":"test"}})
            )
            .await
            .0,
        StatusCode::CONFLICT
    );
    // Create and publish Terraform source directly through the Rust browser UI.
    let admin_cookie = format!("coder_ui_session={admin}");
    let r = server
        .client
        .get(format!("{}/templates/new", server.base))
        .header("Cookie", &admin_cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    assert!(r.text().await.unwrap().contains("Terraform files"));
    let files = json!({"main.tf": r#"terraform { required_version = ">= 1.4" }"#}).to_string();
    let form = [
        ("organization", org.to_string()),
        ("name", "browser-template".into()),
        ("display_name", "Browser template".into()),
        ("description", "Test".into()),
        ("files", files.clone()),
        ("parameters", "[]".into()),
    ];
    let r = server
        .client
        .post(format!("{}/templates/new", server.base))
        .header("Cookie", &admin_cookie)
        .header("Origin", &server.base)
        .form(&form)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::SEE_OTHER);
    let location = r.headers()["location"].to_str().unwrap().to_string();
    let r = server
        .client
        .get(format!("{}{location}", server.base))
        .header("Cookie", &admin_cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    assert!(r.text().await.unwrap().contains("Publish version"));
    let new_id = location.split('/').nth(2).unwrap();
    let (_, new) = server
        .call(
            Method::GET,
            &format!("/api/v2/templates/{new_id}"),
            &admin,
            Value::Null,
        )
        .await;
    let form = [
        ("action", "publish".into()),
        (
            "base_version",
            new["active_version_id"].as_str().unwrap().into(),
        ),
        ("version_name", "v2".into()),
        ("message", "Second version".into()),
        ("files", files),
        ("parameters", "[]".into()),
    ];
    let r = server
        .client
        .post(format!("{}{location}", server.base))
        .header("Cookie", &admin_cookie)
        .header("Origin", &server.base)
        .form(&form)
        .send()
        .await
        .unwrap();
    let status = r.status();
    let body = r.text().await.unwrap();
    assert_eq!(status, StatusCode::SEE_OTHER, "{body}");
    let (_, versions) = server
        .call(
            Method::GET,
            &format!("/api/v2/templates/{new_id}/versions"),
            &admin,
            Value::Null,
        )
        .await;
    assert_eq!(versions.as_array().unwrap().len(), 2);
    let (_, unchanged) = server
        .call(
            Method::GET,
            &format!("/api/v2/templates/{new_id}"),
            &admin,
            Value::Null,
        )
        .await;
    assert_eq!(unchanged["active_version_id"], new["active_version_id"]);
}
