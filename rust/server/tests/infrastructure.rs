//! Real Terraform execution through the Rust worker and PostgreSQL state APIs.

use axum::Router;
use coder_provisioner::Worker;
use reqwest::{Client, Method, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tokio::sync::watch;
use uuid::Uuid;

async fn call(
    client: &Client,
    base: &str,
    method: Method,
    path: &str,
    token: &str,
    worker: bool,
    body: Value,
) -> (StatusCode, Value) {
    let response = client
        .request(method, format!("{base}{path}"))
        .header(
            if worker {
                "Coder-Provisioner-Token"
            } else {
                "Coder-Session-Token"
            },
            token,
        )
        .json(&body)
        .send()
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.bytes().await.unwrap();
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| panic!("Invalid response: {}", String::from_utf8_lossy(&bytes)))
    };
    (status, value)
}

async fn pool() -> PgPool {
    let url = std::env::var("CODER_TEST_DATABASE_URL")
        .expect("Set CODER_TEST_DATABASE_URL to a dedicated test database");
    if std::env::var_os("CODER_TEST_SINGLE_CONNECTION").is_some() {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .unwrap();
        coder_server::migrate(&pool).await.unwrap();
        pool
    } else {
        coder_server::connect(&url).await.unwrap()
    }
}

#[tokio::test]
#[ignore = "requires PostgreSQL and CODER_TEST_TERRAFORM_BINARY; runs real local Terraform operations"]
async fn real_terraform_start_stop_delete_and_state_recovery() {
    let pool = pool().await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let router: Router = coder_server::api(pool.clone(), Some([17; 32]));
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let client = Client::new();
    let (status, _) = call(
        &client,
        &base,
        Method::GET,
        "/api/v2/users/first",
        "",
        false,
        Value::Null,
    )
    .await;
    if status == StatusCode::NOT_FOUND {
        assert_eq!(call(&client,&base,Method::POST,"/api/v2/users/first","",false,json!({"username":"owner","email":"owner@example.test","password":"long-test-password"})).await.0,StatusCode::CREATED);
    }
    let (status, login) = call(
        &client,
        &base,
        Method::POST,
        "/api/v2/users/login",
        "",
        false,
        json!({"email":"owner","password":"long-test-password"}),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "Use a dedicated test database. {login}"
    );
    let token = login["session_token"].as_str().unwrap();
    let (_, orgs) = call(
        &client,
        &base,
        Method::GET,
        "/api/v2/users/me/organizations",
        token,
        false,
        Value::Null,
    )
    .await;
    let org = orgs
        .as_array()
        .unwrap()
        .iter()
        .find(|o| o["name"] == "default")
        .unwrap()["id"]
        .as_str()
        .unwrap();
    let (_, key) = call(
        &client,
        &base,
        Method::POST,
        &format!("/api/v2/organizations/{org}/provisionerkeys"),
        token,
        false,
        json!({}),
    )
    .await;
    let key = key["key"].as_str().unwrap();
    let suffix = &Uuid::new_v4().simple().to_string()[..8];
    let secret = format!("infra-secret-{suffix}");
    assert_eq!(call(&client,&base,Method::POST,"/api/v2/users/me/secrets",token,false,json!({"name":secret,"value":"terraform-state-private-marker","env_name":format!("INFRA_{suffix}")})).await.0,StatusCode::CREATED);
    let mut definition: Value = serde_json::from_str(include_str!(
        "../../provisioner/examples/terraform-template.json"
    ))
    .unwrap();
    definition["provisioner_spec"]["agent"] = json!({"ports":[22]});
    definition["name"] = json!(format!("terraform-{suffix}"));
    let source = definition["provisioner_spec"]["files"]["main.tf"]
        .as_str()
        .unwrap()
        .replace("WORKSPACE_TOKEN", &format!("INFRA_{suffix}"));
    definition["provisioner_spec"]["files"]["main.tf"] = json!(source);
    let (status, template) = call(
        &client,
        &base,
        Method::POST,
        &format!("/api/v2/organizations/{org}/templates"),
        token,
        false,
        definition,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{template}");
    let(status,w)=call(&client,&base,Method::POST,"/api/v2/users/me/workspaces",token,false,
        json!({"name":format!("infra-{suffix}"),"template_version_id":template["active_version_id"],"rich_parameter_values":[{"name":"message","value":"hello"}]})).await;
    assert_eq!(status, StatusCode::CREATED, "{w}");
    let id = w["id"].as_str().unwrap();
    let binary = std::env::var_os("CODER_TEST_TERRAFORM_BINARY")
        .expect("Set CODER_TEST_TERRAFORM_BINARY to a real Terraform executable");
    let recovery = tempfile::tempdir().unwrap();
    let (_shutdown, stopped) = watch::channel(false);
    let worker = if std::env::var_os("CODER_TEST_USE_EMBEDDED_ENGINE").is_some() {
        Worker::with_engine(
            &base,
            key.into(),
            coder_provisioner::engine::Engine::from_environment().unwrap(),
            recovery.path().join("worker-one"),
        )
        .unwrap()
    } else {
        Worker::new(
            &base,
            key.into(),
            binary.clone().into(),
            recovery.path().join("worker-one"),
        )
        .unwrap()
    };
    assert!(worker.run_once(stopped.clone()).await.unwrap());
    let (_, running) = call(
        &client,
        &base,
        Method::GET,
        &format!("/api/v2/workspaces/{id}"),
        token,
        false,
        Value::Null,
    )
    .await;
    assert_eq!(running["latest_build"]["status"], "running");
    assert_eq!(
        running["latest_build"]["resources"][0]["type"],
        "terraform_data"
    );
    assert!(
        !running
            .to_string()
            .contains("terraform-state-private-marker")
    );
    let stored: Vec<u8> = sqlx::query_scalar(
        "SELECT ciphertext FROM coder_rust.provisioner_states WHERE workspace_id=$1",
    )
    .bind(Uuid::parse_str(id).unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        !stored
            .windows(b"terraform-state-private-marker".len())
            .any(|s| s == b"terraform-state-private-marker")
    );
    let (_, meta) = call(
        &client,
        &base,
        Method::GET,
        &format!("/api/v2/workspaces/{id}/provisioner-state"),
        token,
        false,
        Value::Null,
    )
    .await;
    assert!(meta["revision"].as_i64().unwrap() >= 2);
    assert_eq!(meta["recovery_required"], false);

    // A new worker and optionally a different engine restore the same durable state.
    let binary = std::env::var_os("CODER_TEST_ALTERNATE_IAC_BINARY").unwrap_or(binary);
    let worker = Worker::new(
        &base,
        key.into(),
        binary.into(),
        recovery.path().join("worker-two"),
    )
    .unwrap();
    let mirror = tempfile::tempdir().unwrap();
    let worker = worker
        .with_provider_mirror(mirror.path().to_owned())
        .unwrap();
    for (transition, status, count) in [("stop", "stopped", 0), ("start", "running", 1)] {
        assert_eq!(
            call(
                &client,
                &base,
                Method::POST,
                &format!("/api/v2/workspaces/{id}/builds"),
                token,
                false,
                json!({"transition":transition})
            )
            .await
            .0,
            StatusCode::CREATED
        );
        assert!(worker.run_once(stopped.clone()).await.unwrap());
        let (_, w) = call(
            &client,
            &base,
            Method::GET,
            &format!("/api/v2/workspaces/{id}"),
            token,
            false,
            Value::Null,
        )
        .await;
        assert_eq!(w["latest_build"]["status"], status);
        assert_eq!(
            w["latest_build"]["resources"].as_array().unwrap().len(),
            count
        );
    }

    assert_eq!(
        call(
            &client,
            &base,
            Method::POST,
            &format!("/api/v2/workspaces/{id}/builds"),
            token,
            false,
            json!({"transition":"stop"})
        )
        .await
        .0,
        StatusCode::CREATED
    );
    let (_, job) = call(
        &client,
        &base,
        Method::POST,
        "/api/v2/provisioner/jobs/claim?driver=terraform",
        key,
        true,
        json!({}),
    )
    .await;
    let jobid = job["id"].as_str().unwrap();
    let lease = job["lease_token"].as_str().unwrap();
    let (_, snapshot) = call(
        &client,
        &base,
        Method::POST,
        &format!("/api/v2/provisioner/jobs/{jobid}/state/read"),
        key,
        true,
        json!({"lease_token":lease}),
    )
    .await;
    assert!(
        snapshot["state"]
            .to_string()
            .contains("terraform-state-private-marker")
    );
    // State routes accept checkpoints larger than the API's general 128 KiB limit.
    let mut guarded_state = snapshot["state"].clone();
    guarded_state["test_padding"] = json!("x".repeat(160 * 1024));
    let(status,dirty)=call(&client,&base,Method::POST,&format!("/api/v2/provisioner/jobs/{jobid}/state"),key,true,
        json!({"lease_token":lease,"revision":snapshot["revision"],"state":guarded_state,"dirty":true})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        call(
            &client,
            &base,
            Method::POST,
            &format!("/api/v2/provisioner/jobs/{jobid}/complete"),
            key,
            true,
            json!({"lease_token":lease,"state_revision":dirty["revision"],"success":true})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(call(&client,&base,Method::POST,&format!("/api/v2/workspaces/{id}/provisioner-state/recover"),token,false,json!({"revision":dirty["revision"],"state":snapshot["state"],"confirm_workspace_id":id})).await.0,StatusCode::CONFLICT);
    assert_eq!(
        call(
            &client,
            &base,
            Method::PATCH,
            &format!("/api/v2/workspacebuilds/{jobid}/cancel"),
            token,
            false,
            json!({})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(call(&client,&base,Method::POST,&format!("/api/v2/provisioner/jobs/{jobid}/state"),key,true,json!({"lease_token":lease,"revision":dirty["revision"],"state":snapshot["state"],"dirty":false})).await.0,StatusCode::CONFLICT);
    assert_eq!(
        call(
            &client,
            &base,
            Method::POST,
            &format!("/api/v2/workspaces/{id}/builds"),
            token,
            false,
            json!({"transition":"delete"})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(call(&client,&base,Method::POST,&format!("/api/v2/workspaces/{id}/provisioner-state/recover"),token,false,json!({"revision":snapshot["revision"],"state":snapshot["state"],"confirm_workspace_id":id})).await.0,StatusCode::CONFLICT);
    assert_eq!(call(&client,&base,Method::POST,&format!("/api/v2/workspaces/{id}/provisioner-state/recover"),token,false,json!({"revision":dirty["revision"],"state":snapshot["state"],"confirm_workspace_id":id})).await.0,StatusCode::OK);
    assert_eq!(
        call(
            &client,
            &base,
            Method::POST,
            &format!("/api/v2/workspaces/{id}/builds"),
            token,
            false,
            json!({"transition":"delete"})
        )
        .await
        .0,
        StatusCode::CREATED
    );
    assert!(worker.run_once(stopped).await.unwrap());
    assert_eq!(
        call(
            &client,
            &base,
            Method::GET,
            &format!("/api/v2/workspaces/{id}"),
            token,
            false,
            Value::Null
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    task.abort();
}
