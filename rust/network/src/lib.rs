//! Outbound workspace networking with bounded WebSocket frames and TCP half-close.
//! WireGuard encrypts client TCP streams end to end; TLS protects control and terminal hops.

mod cli;
mod terminal;
mod wireguard;
pub use cli::run;
pub use terminal::TerminalConfig;

use futures_util::{SinkExt, StreamExt};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, io, time::Duration};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::TcpStream,
    sync::watch,
    task::JoinSet,
};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async_with_config,
    tungstenite::{Message, client::IntoClientRequest, protocol::WebSocketConfig},
};
use uuid::Uuid;

/// Maximum data payload in a relay frame.
pub const FRAME_SIZE: usize = 32 * 1024;
const TIMEOUT: Duration = Duration::from_secs(10);
type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

fn error(message: &'static str) -> io::Error {
    io::Error::other(message)
}

/// Validates an API root. Credentials are accepted only over HTTPS or loopback HTTP.
pub fn server_url(value: &str) -> io::Result<Url> {
    let url = Url::parse(value).map_err(|_| error("Invalid server URL"))?;
    let local = url.host_str().is_some_and(|h| {
        h == "localhost"
            || h.parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    });
    if url.host_str().is_none()
        || !(url.scheme() == "https" || url.scheme() == "http" && local)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(error(
            "Use an HTTPS root URL or loopback HTTP without credentials or paths",
        ));
    }
    Ok(url)
}

async fn socket(root: &Url, path: &str, header: &str, token: &str) -> io::Result<Socket> {
    let mut url = root.clone();
    url.set_scheme(if root.scheme() == "https" {
        "wss"
    } else {
        "ws"
    })
    .map_err(|_| error("Invalid URL scheme"))?;
    url.set_path(path.split('?').next().unwrap_or(path));
    url.set_query(path.split_once('?').map(|p| p.1));
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|_| error("Invalid connection request"))?;
    let mut value = token
        .parse::<tokio_tungstenite::tungstenite::http::HeaderValue>()
        .map_err(|_| error("Invalid token"))?;
    value.set_sensitive(true);
    request.headers_mut().insert(
        tokio_tungstenite::tungstenite::http::HeaderName::from_bytes(header.as_bytes())
            .map_err(|_| error("Invalid header"))?,
        value,
    );
    let config = WebSocketConfig::default()
        .max_message_size(Some(FRAME_SIZE))
        .max_frame_size(Some(FRAME_SIZE));
    let (socket, _) = tokio::time::timeout(
        TIMEOUT,
        connect_async_with_config(request, Some(config), true),
    )
    .await
    .map_err(|_| error("Connection timed out"))?
    .map_err(|_| error("Connection refused or authentication rejected"))?;
    Ok(socket)
}

/// Copies a byte stream through a connected relay, preserving independent EOFs.
/// Frames contain only binary data or the text marker `eof`.
async fn bridge<R, W>(socket: Socket, mut input: R, mut output: W) -> io::Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let (mut send, mut receive) = socket.split();
    let mut buffer = vec![0; FRAME_SIZE];
    let (mut read_eof, mut write_eof) = (false, false);
    let mut ping = tokio::time::interval(Duration::from_secs(15));
    let mut last = tokio::time::Instant::now();
    loop {
        if read_eof && write_eof {
            let _ = tokio::time::timeout(TIMEOUT, send.close()).await;
            return Ok(());
        }
        tokio::select! {
            n = input.read(&mut buffer), if !read_eof => {
                let n = n?;
                let message = if n==0 { read_eof=true; Message::Text("eof".into()) } else { Message::Binary(buffer[..n].to_vec().into()) };
                tokio::time::timeout(TIMEOUT, send.send(message)).await.map_err(|_| error("Relay backpressure timed out"))?.map_err(|_| error("Relay disconnected"))?;
            }
            message = receive.next() => {
                last = tokio::time::Instant::now();
                match message {
                    Some(Ok(Message::Binary(bytes))) if !write_eof => {
                        tokio::time::timeout(TIMEOUT,output.write_all(&bytes)).await.map_err(|_| error("Local stream blocked"))??;
                        tokio::time::timeout(TIMEOUT,output.flush()).await.map_err(|_|error("Local flush timed out"))??;
                    }
                    Some(Ok(Message::Text(text))) if text=="eof" && !write_eof => { write_eof=true; tokio::time::timeout(TIMEOUT,output.shutdown()).await.map_err(|_|error("Local shutdown timed out"))??; }
                    Some(Ok(Message::Ping(bytes))) => { tokio::time::timeout(TIMEOUT,send.send(Message::Pong(bytes))).await.map_err(|_|error("Relay heartbeat timed out"))?.map_err(|_| error("Relay disconnected"))?; }
                    Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(Message::Close(_))) | None if write_eof => return Ok(()),
                    _ => return Err(error("Relay disconnected or sent an invalid frame")),
                }
            }
            _ = ping.tick() => {
                if last.elapsed()>Duration::from_secs(60) { return Err(error("Relay heartbeat expired")); }
                tokio::time::timeout(TIMEOUT,send.send(Message::Ping(Vec::new().into()))).await.map_err(|_| error("Relay heartbeat timed out"))?.map_err(|_| error("Relay disconnected"))?;
            }
        }
    }
}

/// Connects authenticated standard I/O or a TCP stream to an allowed workspace port.
pub async fn connect<R, W>(
    server: &str,
    token: &str,
    workspace: Uuid,
    port: u16,
    input: R,
    output: W,
) -> io::Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    if port == 0 {
        return Err(error("Port must be nonzero"));
    }
    let key = wireguard::Key::new();
    let public = key.public();
    let mut ws = socket(
        &server_url(server)?,
        &format!("/api/v2/workspaces/{workspace}/connect?port={port}&wireguard={public}"),
        "Coder-Session-Token",
        token,
    )
    .await?;
    // Do not consume local input until the agent has connected its TCP target.
    let ready = tokio::time::timeout(Duration::from_secs(30), ws.next())
        .await
        .map_err(|_| error("Agent connection timed out"))?;
    let Some(Ok(Message::Text(ready))) = ready else {
        return Err(error("Workspace agent could not connect"));
    };
    let ready: serde_json::Value =
        serde_json::from_str(&ready).map_err(|_| error("WireGuard negotiation required"))?;
    let remote = ready["wireguard"]
        .as_str()
        .filter(|_| ready["ready"] == true)
        .ok_or_else(|| error("WireGuard negotiation required"))?;
    wireguard::bridge(ws, key, remote, true, input, output).await
}

/// One pending connection requested by the authenticated control plane.
#[derive(Serialize, Deserialize)]
pub struct Connection {
    /// Single-use connection ticket.
    pub id: Uuid,
    /// Loopback TCP port, independently checked against the agent allowlist.
    pub port: u16,
    /// Optional client WireGuard public key, represented as 64 hex characters.
    #[serde(default)]
    pub wireguard: Option<String>,
    /// Requests an opted-in local interactive PTY instead of a TCP port.
    #[serde(default)]
    pub terminal: bool,
}

/// Runs an outbound agent until shutdown. Every target is IPv4 loopback.
/// Reconnects do not restore old sessions; clients reconnect explicitly.
pub async fn agent(
    server: &str,
    token: &str,
    ports: BTreeSet<u16>,
    shutdown: watch::Receiver<bool>,
) -> io::Result<()> {
    agent_with_terminal(server, token, ports, None, shutdown).await
}

/// Runs an agent with explicit local shell configuration. Server approval is also required.
pub async fn agent_with_terminal(
    server: &str,
    token: &str,
    ports: BTreeSet<u16>,
    terminal: Option<TerminalConfig>,
    mut shutdown: watch::Receiver<bool>,
) -> io::Result<()> {
    if let Some(config) = &terminal {
        config.validate()?;
    }
    if ports.is_empty() || ports.len() > 16 || ports.contains(&0) {
        return Err(error("Allow 1-16 nonzero local ports"));
    }
    let root = server_url(server)?;
    loop {
        if *shutdown.borrow() {
            return Ok(());
        }
        let result = tokio::select! {
            result=socket(&root,"/api/v2/workspaceagents/me/listen","Coder-Agent-Token",token)=>result,
            _=shutdown.changed()=>return Ok(()),
        };
        if let Ok(ws) = result {
            let (mut send, mut receive) = ws.split();
            let mut tasks = JoinSet::new();
            let mut ping = tokio::time::interval(Duration::from_secs(15));
            let mut last = tokio::time::Instant::now();
            loop {
                tokio::select! {
                    _=shutdown.changed()=>{tasks.abort_all();return Ok(());}
                    message=receive.next()=>{
                        last=tokio::time::Instant::now();
                        match message {
                            Some(Ok(Message::Text(text)))=>{
                                let Ok(connection)=serde_json::from_str::<Connection>(&text) else {break;};
                                if tasks.len()>=32 || (connection.terminal && terminal.is_none()) || (!connection.terminal && !ports.contains(&connection.port)) || (connection.terminal && connection.wireguard.is_some()) {
                                    if tokio::time::timeout(TIMEOUT,send.send(Message::Text(serde_json::json!({"failed":connection.id}).to_string().into()))).await.map_or(true,|r|r.is_err()){break;}
                                    continue;
                                }
                                let root=root.clone();let token=token.to_owned();let terminal=terminal.clone();
                                tasks.spawn(async move {
                                    let id=connection.id;
                                    let result=async {
                                        if connection.terminal {
                                            let socket=socket(&root,&format!("/api/v2/workspaceagents/me/connections/{id}"),"Coder-Agent-Token",&token).await?;
                                            return terminal::run(socket,terminal.ok_or_else(||error("Terminal disabled"))?).await;
                                        }
                                        let stream=tokio::time::timeout(TIMEOUT,TcpStream::connect((std::net::Ipv4Addr::LOCALHOST,connection.port))).await.map_err(|_|error("Local connection timed out"))??;
                                        let (read,write)=stream.into_split();
                                        if let Some(remote)=connection.wireguard {
                                            let key=wireguard::Key::new();let public=key.public();
                                            let socket=socket(&root,&format!("/api/v2/workspaceagents/me/connections/{id}?key={public}"),"Coder-Agent-Token",&token).await?;
                                            wireguard::bridge(socket,key,&remote,false,read,write).await
                                        }else{
                                            let socket=socket(&root,&format!("/api/v2/workspaceagents/me/connections/{id}"),"Coder-Agent-Token",&token).await?;
                                            bridge(socket,read,write).await
                                        }
                                    }.await;
                                    (id,result)
                                });
                            }
                            Some(Ok(Message::Ping(bytes)))=>{if tokio::time::timeout(TIMEOUT,send.send(Message::Pong(bytes))).await.map_or(true,|r|r.is_err()){break;}}
                            Some(Ok(Message::Pong(_)))=>{}
                            _=>break,
                        }
                    }
                    result=tasks.join_next(), if !tasks.is_empty()=>{
                        if let Some(Ok((id,Err(_))))=result {
                            if tokio::time::timeout(TIMEOUT,send.send(Message::Text(serde_json::json!({"failed":id}).to_string().into()))).await.map_or(true,|r|r.is_err()){break;}
                        }
                    }
                    _=ping.tick()=>{
                        if last.elapsed()>Duration::from_secs(60) || tokio::time::timeout(TIMEOUT,send.send(Message::Ping(Vec::new().into()))).await.map_or(true,|r|r.is_err()){break;}
                    }
                }
            }
            tasks.abort_all();
        }
        tokio::select! {_=tokio::time::sleep(Duration::from_secs(3))=>{},_=shutdown.changed()=>return Ok(())}
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn rejects_credential_leaking_or_ambiguous_roots() {
        for url in [
            "http://example.com",
            "https://user:password@example.com",
            "https://example.com/path",
            "https://example.com/?token=secret",
            "https://example.com/#fragment",
            "file:///etc/passwd",
        ] {
            assert!(super::server_url(url).is_err(), "{url}");
        }
        for url in [
            "https://example.com",
            "http://127.0.0.1:3000",
            "http://localhost:3000",
        ] {
            assert!(super::server_url(url).is_ok());
        }
    }
}
