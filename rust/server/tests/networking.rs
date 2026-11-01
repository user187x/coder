//! Real outbound agent and TCP relay, including half-close, isolation, and revocation.

use futures_util::{SinkExt, StreamExt};
use reqwest::{Client, Method, StatusCode};
use serde_json::{Value, json};
use std::time::Duration;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::watch,
};
use tokio_tungstenite::tungstenite::{Message, client::IntoClientRequest};
use uuid::Uuid;

struct Fixture {
    base: String,
    client: Client,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
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
            .client
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
}
async fn pool() -> sqlx::PgPool {
    let url = std::env::var("CODER_TEST_DATABASE_URL")
        .expect("Dedicated test PostgreSQL database required");
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
async fn exchange(base: String, token: String, workspace: Uuid, port: u16, payload: Vec<u8>) {
    let (mut caller, local) = tokio::io::duplex(64 * 1024);
    let (read, write) = tokio::io::split(local);
    let tunnel = tokio::spawn(async move {
        coder_network::connect(&base, &token, workspace, port, read, write).await
    });
    caller.write_all(&payload).await.unwrap();
    caller.shutdown().await.unwrap();
    let mut received = Vec::new();
    caller.read_to_end(&mut received).await.unwrap();
    let expected = payload.into_iter().rev().collect::<Vec<_>>();
    assert_eq!(received, expected);
    tunnel.await.unwrap().unwrap();
}
async fn wait_online(f: &Fixture, id: Uuid, session: &str) {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let (_, agent) = f
                .call(
                    Method::GET,
                    &format!("/api/v2/workspaces/{id}/agent"),
                    session,
                    Value::Null,
                )
                .await;
            if agent["connected"] == true {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("agent connected");
}

#[tokio::test]
#[ignore = "requires a dedicated PostgreSQL database in CODER_TEST_DATABASE_URL"]
async fn outbound_relay_preserves_half_close_and_enforces_workspace_access() {
    tokio::time::timeout(Duration::from_secs(60),async{
        let pool=pool().await;
        let listener=TcpListener::bind("127.0.0.1:0").await.unwrap();let base=format!("http://{}",listener.local_addr().unwrap());
        let app=coder_server::api(pool.clone(),Some([17;32]));
        let task=tokio::spawn(async move{axum::serve(listener,app).await.unwrap();});
        let f=Fixture{base,task,client:Client::new()};
        if f.call(Method::GET,"/api/v2/users/first","",Value::Null).await.0==StatusCode::NOT_FOUND {
            assert_eq!(f.call(Method::POST,"/api/v2/users/first","",json!({"username":"owner","email":"owner@example.test","password":"long-test-password"})).await.0,StatusCode::CREATED);
        }
        let (_,login)=f.call(Method::POST,"/api/v2/users/login","",json!({"email":"owner","password":"long-test-password"})).await;
        let session=login["session_token"].as_str().unwrap();
        let (_,orgs)=f.call(Method::GET,"/api/v2/users/me/organizations",session,Value::Null).await;
        let org=orgs.as_array().unwrap().iter().find(|o|o["name"]=="default").unwrap()["id"].as_str().unwrap();
        let suffix=Uuid::new_v4().simple().to_string();let suffix=&suffix[..8];
        let (_,template)=f.call(Method::POST,&format!("/api/v2/organizations/{org}/templates"),session,json!({"name":format!("net-{suffix}"),"provisioner_spec":{"driver":"relay-test"}})).await;
        let (status,w)=f.call(Method::POST,"/api/v2/users/me/workspaces",session,json!({"name":format!("net-{suffix}"),"template_version_id":template["active_version_id"]})).await;
        assert_eq!(status,StatusCode::CREATED,"{w}");let id:Uuid=w["id"].as_str().unwrap().parse().unwrap();
        // The infrastructure worker protocol itself is covered by the infrastructure test.
        sqlx::query("UPDATE coder_rust.builds SET status='running' WHERE id=$1").bind(Uuid::parse_str(w["latest_build"]["id"].as_str().unwrap()).unwrap()).execute(&pool).await.unwrap();
        let listener=TcpListener::bind("127.0.0.1:0").await.unwrap();let port=listener.local_addr().unwrap().port();
        let (accepted,mut arrivals)=tokio::sync::mpsc::channel(32);
        let service=tokio::spawn(async move{
            loop {
                let (mut stream,_)=listener.accept().await.unwrap();let accepted=accepted.clone();
                tokio::spawn(async move{
                    let _=accepted.send(()).await;
                    let mut bytes=Vec::new();if stream.read_to_end(&mut bytes).await.is_ok(){bytes.reverse();let _=stream.write_all(&bytes).await;let _=stream.shutdown().await;}
                });
            }
        });
        let (status,registration)=f.call(Method::POST,&format!("/api/v2/workspaces/{id}/agent"),session,json!({"ports":[port]})).await;
        assert_eq!(status,StatusCode::OK);let key=registration["token"].as_str().unwrap().to_owned();
        let ciphertext:Vec<u8>=sqlx::query_scalar("SELECT ciphertext FROM coder_rust.workspace_agents WHERE workspace_id=$1").bind(id).fetch_one(&pool).await.unwrap();
        assert!(!ciphertext.windows(key.len()).any(|bytes|bytes==key.as_bytes()));
        let (stop,shutdown)=watch::channel(false);let base=f.base.clone();let agent_key=key.clone();
        let agent=tokio::spawn(async move{coder_network::agent(&base,&agent_key,[port].into(),shutdown).await});
        wait_online(&f,id,session).await;
        let mut transfers=tokio::task::JoinSet::new();
        for n in 0..4 {
            let payload=(0..256*1024).map(|i|((i+n)%251)as u8).collect();
            transfers.spawn(exchange(f.base.clone(),session.to_owned(),id,port,payload));
        }
        while let Some(result)=transfers.join_next().await{result.unwrap();}
        while arrivals.try_recv().is_ok(){}
        let forbidden=if port==65535{port-1}else{port+1};
        assert!(coder_network::connect(&f.base,session,id,forbidden,tokio::io::empty(),tokio::io::sink()).await.is_err());
        let other=format!("other-{suffix}");
        assert_eq!(f.call(Method::POST,"/api/v2/users",session,json!({"username":other,"email":format!("{other}@example.test"),"password":"long-test-password","organization_ids":[org]})).await.0,StatusCode::CREATED);
        let (_,login)=f.call(Method::POST,"/api/v2/users/login","",json!({"email":other,"password":"long-test-password"})).await;
        let stranger=login["session_token"].as_str().unwrap();
        assert_eq!(f.call(Method::POST,&format!("/api/v2/workspaces/{id}/agent"),stranger,json!({"ports":[port]})).await.0,StatusCode::FORBIDDEN);
        assert!(coder_network::connect(&f.base,stranger,id,port,tokio::io::empty(),tokio::io::sink()).await.is_err());
        // Session logout also fences a stream without revoking the workspace agent.
        let (_,temporary_login)=f.call(Method::POST,"/api/v2/users/login","",json!({"email":"owner","password":"long-test-password"})).await;
        let temporary_session=temporary_login["session_token"].as_str().unwrap().to_owned();
        let (mut temporary_caller,local)=tokio::io::duplex(1024);let (read,write)=tokio::io::split(local);
        let base=f.base.clone();let connection_session=temporary_session.clone();
        let temporary_tunnel=tokio::spawn(async move{coder_network::connect(&base,&connection_session,id,port,read,write).await});
        temporary_caller.write_all(b"logout check").await.unwrap();
        tokio::time::timeout(Duration::from_secs(10),arrivals.recv()).await.unwrap().unwrap();
        assert_eq!(f.call(Method::POST,"/api/v2/users/logout",&temporary_session,Value::Null).await.0,StatusCode::OK);
        let _=tokio::time::timeout(Duration::from_secs(8),temporary_tunnel).await.expect("logout disconnects active stream").unwrap();
        // An already-established stream must terminate when its agent credential is revoked.
        let (mut caller,local)=tokio::io::duplex(1024);let (read,write)=tokio::io::split(local);let base=f.base.clone();let session_owned=session.to_owned();
        let tunnel=tokio::spawn(async move{coder_network::connect(&base,&session_owned,id,port,read,write).await});
        caller.write_all(b"keep open").await.unwrap();
        tokio::time::timeout(Duration::from_secs(10),arrivals.recv()).await.unwrap().unwrap();
        assert_eq!(f.call(Method::DELETE,&format!("/api/v2/workspaces/{id}/agent"),session,Value::Null).await.0,StatusCode::NO_CONTENT);
        let _=tokio::time::timeout(Duration::from_secs(8),tunnel).await.expect("revocation disconnects active stream").unwrap();
        assert!(coder_network::connect(&f.base,session,id,port,tokio::io::empty(),tokio::io::sink()).await.is_err());
        stop.send(true).unwrap();agent.await.unwrap().unwrap();
        // The data channel accepts each agent-bound ticket exactly once.
        let (_,registration)=f.call(Method::POST,&format!("/api/v2/workspaces/{id}/agent"),session,json!({"ports":[port]})).await;
        let new_key=registration["token"].as_str().unwrap();
        let mut request=format!("{}/api/v2/workspaceagents/me/listen",f.base.replace("http://","ws://")).into_client_request().unwrap();
        request.headers_mut().insert("Coder-Agent-Token",new_key.parse().unwrap());
        let (mut control,_)=tokio_tungstenite::connect_async(request).await.unwrap();
        wait_online(&f,id,session).await;
        let base=f.base.clone();let owner=session.to_owned();
        let connected=tokio::spawn(async move{coder_network::connect(&base,&owner,id,port,tokio::io::empty(),tokio::io::sink()).await});
        let ticket=loop {
            match control.next().await.unwrap().unwrap(){
                Message::Text(text)=>break serde_json::from_str::<Value>(&text).unwrap()["id"].as_str().unwrap().to_owned(),
                Message::Ping(bytes)=>control.send(Message::Pong(bytes)).await.unwrap(),
                Message::Pong(_)=>{},
                _=>panic!("invalid control message"),
            }
        };
        let mut request=format!("{}/api/v2/workspaceagents/me/connections/{ticket}?key={}",f.base.replace("http://","ws://"),"01".repeat(32)).into_client_request().unwrap();
        request.headers_mut().insert("Coder-Agent-Token",new_key.parse().unwrap());
        let (mut data,_)=tokio_tungstenite::connect_async(request.clone()).await.unwrap();
        assert!(tokio_tungstenite::connect_async(request).await.is_err(),"ticket replay accepted");
        data.send(Message::Binary(b"reply".to_vec().into())).await.unwrap();
        data.send(Message::Text("eof".into())).await.unwrap();
        let _=data.close(None).await;
        assert!(connected.await.unwrap().is_err(),"WireGuard must reject plaintext downgrade");
        let _=control.close(None).await;
        service.abort();
    }).await.expect("network integration deadline");
}
