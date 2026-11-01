//! Owner-authorized workspace TCP relay. Agent tickets are single-use and scoped.

use crate::{App, Error, Result, auth, workspaces};
use aes_gcm::{
    Aes256Gcm, KeyInit, Nonce,
    aead::{Aead, Payload},
};
use axum::{
    Json,
    extract::{
        Path, Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, StatusCode},
    response::Response,
};
use rand::RngCore;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::{BTreeSet, HashMap},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::{Semaphore, mpsc, oneshot};
use uuid::Uuid;

fn cipher(app: &App) -> Result<Aes256Gcm> {
    Ok(Aes256Gcm::new_from_slice(&app.secret_key.ok_or_else(|| {
        Error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Configure CODER_ENCRYPTION_KEY before creating agent credentials.".into(),
        )
    })?)
    .expect("256-bit key"))
}
async fn credential(
    app: &App,
    conn: &mut sqlx::PgConnection,
    workspace: Uuid,
    org: Uuid,
    ports: &BTreeSet<u16>,
    rotate: bool,
) -> Result<Value> {
    let token = auth::token();
    let agent = Uuid::new_v4();
    let mut nonce = [0; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let aad = format!("agent:{org}:{workspace}");
    let cipher = cipher(app)?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: token.as_bytes(),
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| Error::bad("Agent encryption failed."))?;
    let query = if rotate {
        "INSERT INTO coder_rust.workspace_agents(workspace_id,organization_id,id,token_hash,ports,nonce,ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(workspace_id) DO UPDATE SET id=EXCLUDED.id,token_hash=EXCLUDED.token_hash,ports=EXCLUDED.ports,nonce=EXCLUDED.nonce,ciphertext=EXCLUDED.ciphertext,last_connected_at=NULL RETURNING id,nonce,ciphertext"
    } else {
        "INSERT INTO coder_rust.workspace_agents(workspace_id,organization_id,id,token_hash,ports,nonce,ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(workspace_id) DO UPDATE SET ports=EXCLUDED.ports RETURNING id,nonce,ciphertext"
    };
    let (agent, nonce, ciphertext): (Uuid, Vec<u8>, Vec<u8>) = sqlx::query_as(query)
        .bind(workspace)
        .bind(org)
        .bind(agent)
        .bind(auth::digest(&token))
        .bind(json!(ports))
        .bind(nonce.as_slice())
        .bind(ciphertext)
        .fetch_one(conn)
        .await?;
    if nonce.len() != 12 {
        return Err(Error::bad("Invalid agent nonce."));
    }
    let token = cipher
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| {
            Error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Agent key could not be decrypted.".into(),
            )
        })?;
    let token = String::from_utf8(token).map_err(|_| Error::bad("Invalid agent key encoding."))?;
    Ok(json!({"id":agent,"token":token,"ports":ports}))
}

pub(crate) async fn bootstrap(
    app: &App,
    conn: &mut sqlx::PgConnection,
    build: &workspaces::Build,
    spec: &Value,
) -> Result<Value> {
    if spec["driver"] != "terraform" || spec.get("agent").is_none() {
        return Ok(Value::Null);
    }
    let allowed: BTreeSet<u16> = serde_json::from_value(spec["agent"]["ports"].clone())
        .map_err(|_| Error::bad("Invalid template agent ports."))?;
    ports(&allowed)?;
    credential(
        app,
        conn,
        build.workspace_id,
        build.organization_id,
        &allowed,
        false,
    )
    .await
}

const CHECK_INTERVAL: Duration = Duration::from_secs(2);
const IO_TIMEOUT: Duration = Duration::from_secs(10);
const FRAME: usize = 32 * 1024;

#[derive(Clone)]
struct Control {
    agent: Uuid,
    generation: Uuid,
    sender: mpsc::Sender<Value>,
    permits: Arc<Semaphore>,
}
struct Pending {
    agent: Uuid,
    generation: Uuid,
    sender: oneshot::Sender<WebSocket>,
}

pub(crate) struct Broker {
    controls: Mutex<HashMap<Uuid, Control>>,
    pending: Mutex<HashMap<Uuid, Pending>>,
    permits: Arc<Semaphore>,
}
impl Default for Broker {
    fn default() -> Self {
        Self {
            controls: Mutex::new(HashMap::new()),
            pending: Mutex::new(HashMap::new()),
            permits: Arc::new(Semaphore::new(1024)),
        }
    }
}
impl Broker {
    fn remove(&self, workspace: Uuid, generation: Option<Uuid>) {
        let mut controls = self.controls.lock().expect("broker lock");
        if let Some(control) = controls.get(&workspace) {
            if generation.is_none_or(|g| g == control.generation) {
                let removed = controls.remove(&workspace).expect("control");
                self.pending
                    .lock()
                    .expect("broker lock")
                    .retain(|_, p| p.generation != removed.generation);
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Register {
    ports: BTreeSet<u16>,
}
fn ports(ports: &BTreeSet<u16>) -> Result<()> {
    if ports.is_empty() || ports.len() > 16 || ports.contains(&0) {
        return Err(Error::bad("Allow 1-16 nonzero local ports."));
    }
    Ok(())
}

/// POST /api/v2/workspaces/{id}/agent: rotates a workspace's scoped agent key.
pub(crate) async fn register(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<Register>,
) -> Result {
    ports(&req.ports)?;
    let actor = auth::actor(&app, &headers).await?;
    let workspace = workspaces::authorized(&app, &actor, id).await?;
    let result = credential(
        &app,
        &mut *app.pool.acquire().await?,
        id,
        workspace.organization_id,
        &req.ports,
        true,
    )
    .await?;
    app.broker.remove(id, None);
    Ok(Json(result))
}

/// DELETE /api/v2/workspaces/{id}/agent: revokes keys and open relay sessions.
pub(crate) async fn revoke(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode> {
    let actor = auth::actor(&app, &headers).await?;
    workspaces::authorized(&app, &actor, id).await?;
    sqlx::query("DELETE FROM coder_rust.workspace_agents WHERE workspace_id=$1")
        .bind(id)
        .execute(&app.pool)
        .await?;
    app.broker.remove(id, None);
    Ok(StatusCode::NO_CONTENT)
}

/// GET /api/v2/workspaces/{id}/agent: returns connection metadata without credentials.
pub(crate) async fn inspect(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    workspaces::authorized(&app, &actor, id).await?;
    let row: Option<(Uuid, Value)> =
        sqlx::query_as("SELECT id,ports FROM coder_rust.workspace_agents WHERE workspace_id=$1")
            .bind(id)
            .fetch_optional(&app.pool)
            .await?;
    let Some((agent, ports)) = row else {
        return Ok(Json(Value::Null));
    };
    let connected = app
        .broker
        .controls
        .lock()
        .expect("broker lock")
        .get(&id)
        .is_some_and(|c| c.agent == agent);
    Ok(Json(
        json!({"id":agent,"ports":ports,"connected":connected}),
    ))
}

#[derive(sqlx::FromRow)]
struct Agent {
    id: Uuid,
    workspace_id: Uuid,
}
async fn authorized_agent(app: &App, headers: &HeaderMap) -> Result<Agent> {
    let token = crate::header(headers, "Coder-Agent-Token")?;
    sqlx::query_as("SELECT a.id,a.workspace_id FROM coder_rust.workspace_agents a JOIN coder_rust.workspaces w ON w.id=a.workspace_id AND w.organization_id=a.organization_id JOIN coder_rust.builds b ON b.id=w.latest_build_id JOIN coder_rust.users u ON u.id=w.owner_id JOIN coder_rust.memberships m ON m.user_id=u.id AND m.organization_id=w.organization_id WHERE a.token_hash=$1 AND NOT w.deleted AND u.status='active' AND b.status IN ('starting','running')")
        .bind(auth::digest(token)).fetch_optional(&app.pool).await?.ok_or_else(||Error(StatusCode::UNAUTHORIZED,"Agent revoked or workspace unavailable.".into()))
}

fn upgrade(ws: WebSocketUpgrade) -> WebSocketUpgrade {
    ws.max_message_size(FRAME)
        .max_frame_size(FRAME)
        .max_write_buffer_size(128 * 1024)
        .write_buffer_size(0)
}

/// GET /api/v2/workspaceagents/me/listen: outbound authenticated control socket.
pub(crate) async fn listen(
    State(app): State<App>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<Response> {
    let agent = authorized_agent(&app, &headers).await?;
    Ok(upgrade(ws).on_upgrade(move |mut socket| async move {
        let (sender,mut receive)=mpsc::channel(32);
        let generation=Uuid::new_v4();
        let control=Control{agent:agent.id,generation,sender,permits:Arc::new(Semaphore::new(32))};
        // A fresh control socket replaces any old connection for this workspace.
        app.broker.remove(agent.workspace_id,None);
        app.broker.controls.lock().expect("broker lock").insert(agent.workspace_id,control);
        let _=sqlx::query("UPDATE coder_rust.workspace_agents SET last_connected_at=now() WHERE id=$1").bind(agent.id).execute(&app.pool).await;
        let mut check=tokio::time::interval(CHECK_INTERVAL);
        let mut last=tokio::time::Instant::now();
        loop {
            tokio::select! {
                notice=receive.recv()=>{
                    let Some(notice)=notice else {break;};
                    if tokio::time::timeout(IO_TIMEOUT,socket.send(Message::Text(notice.to_string().into()))).await.map_or(true,|r|r.is_err()){break;}
                }
                incoming=socket.recv()=>{
                    match incoming {
                        Some(Ok(Message::Text(text)))=>{
                            let Ok(value)=serde_json::from_str::<Value>(&text) else {break;};
                            let Some(id)=value["failed"].as_str().and_then(|s|Uuid::parse_str(s).ok()) else {break;};
                            let mut pending=app.broker.pending.lock().expect("broker lock");
                            if pending.get(&id).is_some_and(|p|p.agent==agent.id && p.generation==generation){pending.remove(&id);}
                        }
                        Some(Ok(Message::Ping(_)|Message::Pong(_)))=>{last=tokio::time::Instant::now();}
                        _=>break,
                    }
                }
                _=check.tick()=>{
                    let valid=app.broker.controls.lock().expect("broker lock").get(&agent.workspace_id).is_some_and(|c|c.generation==generation);
                    if !valid || last.elapsed()>Duration::from_secs(60) || authorized_agent(&app,&headers).await.is_err(){break;}
                    if tokio::time::timeout(IO_TIMEOUT,socket.send(Message::Ping(Vec::new().into()))).await.map_or(true,|r|r.is_err()){break;}
                }
            }
        }
        app.broker.remove(agent.workspace_id,Some(generation));
        close(socket).await;
    }))
}

/// GET /api/v2/workspaceagents/me/connections/{id}: consumes an agent-bound ticket.
pub(crate) async fn attach(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    ws: WebSocketUpgrade,
) -> Result<Response> {
    let agent = authorized_agent(&app, &headers).await?;
    let pending = {
        let mut pending = app.broker.pending.lock().expect("broker lock");
        if !pending.get(&id).is_some_and(|p| p.agent == agent.id) {
            return Err(Error::forbidden());
        }
        pending.remove(&id).expect("pending ticket")
    };
    Ok(upgrade(ws).on_upgrade(move |socket| async move {
        let _ = pending.sender.send(socket);
    }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Target {
    port: u16,
}
async fn client(app: &App, headers: &HeaderMap, id: Uuid, port: u16) -> Result<Uuid> {
    let actor = auth::actor(app, headers).await?;
    workspaces::authorized(app, &actor, id).await?;
    let row:Option<(Uuid,Value)>=sqlx::query_as("SELECT a.id,a.ports FROM coder_rust.workspace_agents a JOIN coder_rust.workspaces w ON w.id=a.workspace_id JOIN coder_rust.builds b ON b.id=w.latest_build_id WHERE w.id=$1 AND b.status='running' AND NOT EXISTS(SELECT 1 FROM coder_rust.provisioner_states s WHERE s.workspace_id=w.id AND s.dirty)")
        .bind(id).fetch_optional(&app.pool).await?;
    let Some((agent, ports)) = row else {
        return Err(Error::conflict(
            "Workspace is not running or requires infrastructure recovery.",
        ));
    };
    if !ports
        .as_array()
        .is_some_and(|ports| ports.iter().any(|p| p.as_u64() == Some(u64::from(port))))
    {
        return Err(Error::forbidden());
    }
    Ok(agent)
}

/// GET /api/v2/workspaces/{id}/connect?port=N: owner session authenticated TCP relay.
pub(crate) async fn connect(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Query(target): Query<Target>,
    ws: WebSocketUpgrade,
) -> Result<Response> {
    let agent = client(&app, &headers, id, target.port).await?;
    let control = app
        .broker
        .controls
        .lock()
        .expect("broker lock")
        .get(&id)
        .filter(|c| c.agent == agent)
        .cloned()
        .ok_or_else(|| {
            Error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Workspace agent is offline.".into(),
            )
        })?;
    let global = app
        .broker
        .permits
        .clone()
        .try_acquire_owned()
        .map_err(|_| {
            Error(
                StatusCode::TOO_MANY_REQUESTS,
                "Relay capacity reached.".into(),
            )
        })?;
    let permit = control.permits.clone().try_acquire_owned().map_err(|_| {
        Error(
            StatusCode::TOO_MANY_REQUESTS,
            "Workspace connection limit reached.".into(),
        )
    })?;
    Ok(upgrade(ws).on_upgrade(move |mut socket| async move {
        let (_global,_permit)=(global,permit);
        let ticket=Uuid::new_v4();let (send,receive)=oneshot::channel();
        app.broker.pending.lock().expect("broker lock").insert(ticket,Pending{agent,generation:control.generation,sender:send});
        let mut peer=if control.sender.try_send(json!({"id":ticket,"port":target.port})).is_ok(){
            tokio::time::timeout(Duration::from_secs(20),receive).await.ok().and_then(|r|r.ok())
        } else {None};
        app.broker.pending.lock().expect("broker lock").remove(&ticket);
        if let Some(ref mut peer)=peer {
            if tokio::time::timeout(IO_TIMEOUT,socket.send(Message::Text("ready".into()))).await.is_ok_and(|r|r.is_ok()) {
                let mut check=tokio::time::interval(CHECK_INTERVAL);
                let (mut left_eof,mut right_eof)=(false,false);
                loop {
                    if left_eof && right_eof {break;}
                    let result=tokio::select! {
                        incoming=socket.recv()=>forward(incoming,peer,&mut left_eof).await,
                        incoming=peer.recv()=>forward(incoming,&mut socket,&mut right_eof).await,
                        _=check.tick()=>{
                            let current=app.broker.controls.lock().expect("broker lock").get(&id).is_some_and(|c|c.generation==control.generation);
                            if !current || client(&app,&headers,id,target.port).await.is_err(){false}else{
                                tokio::time::timeout(IO_TIMEOUT,socket.send(Message::Ping(Vec::new().into()))).await.is_ok_and(|r|r.is_ok())
                                && tokio::time::timeout(IO_TIMEOUT,peer.send(Message::Ping(Vec::new().into()))).await.is_ok_and(|r|r.is_ok())
                            }
                        }
                    };
                    if !result {break;}
                }
            }
        }
        if let Some(peer)=peer {tokio::join!(close(peer),close(socket));}else{close(socket).await;}
    }))
}

async fn forward(
    message: Option<std::result::Result<Message, axum::Error>>,
    target: &mut WebSocket,
    eof: &mut bool,
) -> bool {
    let message = match message {
        Some(Ok(Message::Binary(bytes))) if !*eof => Message::Binary(bytes),
        Some(Ok(Message::Text(text))) if text == "eof" && !*eof => {
            *eof = true;
            Message::Text(text)
        }
        Some(Ok(Message::Ping(_) | Message::Pong(_))) => return true,
        _ => return false,
    };
    tokio::time::timeout(IO_TIMEOUT, target.send(message))
        .await
        .is_ok_and(|r| r.is_ok())
}

// Keep TCP open for the close handshake so unread EOF frames survive concurrent pings.
async fn close(mut socket: WebSocket) {
    let _ = tokio::time::timeout(IO_TIMEOUT, async {
        if socket.send(Message::Close(None)).await.is_ok() {
            while let Some(Ok(message)) = socket.recv().await {
                if matches!(message, Message::Close(_)) {
                    break;
                }
            }
        }
    })
    .await;
}
