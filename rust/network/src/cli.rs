//! Agent and client commands. Credentials are read from the environment.

use std::{collections::BTreeSet, env, net::SocketAddr};
use tokio::{net::TcpListener, sync::watch, task::JoinSet};
use uuid::Uuid;

fn token(name: &str) -> Result<String, Box<dyn std::error::Error>> {
    Ok(env::var(name).map_err(|_| format!("{name} is required"))?)
}

/// Runs the agent, registration, stdio connection, or loopback forward command.
pub async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let server = env::var("CODER_URL").unwrap_or_else(|_| "http://127.0.0.1:3000".into());
    let args = env::args().skip(1).collect::<Vec<_>>();
    let (stop, mut stopped) = watch::channel(false);
    let signal = tokio::spawn(async move {
        #[cfg(unix)]
        {
            let mut term =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    .expect("SIGTERM handler");
            tokio::select! {_=tokio::signal::ctrl_c()=>{},_=term.recv()=>{}}
        }
        #[cfg(not(unix))]
        let _ = tokio::signal::ctrl_c().await;
        let _ = stop.send(true);
    });
    let result: Result<(),Box<dyn std::error::Error>>=async {
        match args.first().map(String::as_str) {
            Some("agent") if args.len()==1=>{
                let ports=env::var("CODER_AGENT_PORTS").unwrap_or_else(|_|"22".into()).split(',').map(str::parse).collect::<Result<BTreeSet<u16>,_>>()?;
                crate::agent(&server,&token("CODER_AGENT_TOKEN")?,ports,stopped.clone()).await?;
            }
            Some("connect"|"forward") if (3..=4).contains(&args.len())=>{
                let workspace:Uuid=args[1].parse()?;let port:u16=args[2].parse()?;
                let session=token("CODER_SESSION_TOKEN")?;
                if args[0]=="connect" && args.len()==3 {
                    tokio::select!{r=crate::connect(&server,&session,workspace,port,tokio::io::stdin(),tokio::io::stdout())=>r?,_=stopped.changed()=>{}}
                }else if args[0]=="forward" && args.len()==4 {
                    let listen:SocketAddr=args[3].parse()?;
                    if !listen.ip().is_loopback(){return Err("Local forwards must bind a loopback address".into());}
                    let listener=TcpListener::bind(listen).await?;
                    eprintln!("Workspace forward listening on {}",listener.local_addr()?);
                    let mut tasks=JoinSet::new();
                    loop {
                        tokio::select! {
                            _=stopped.changed()=>break,
                            accepted=listener.accept(), if tasks.len()<32=>{
                                let (stream,_)=accepted?;let server=server.clone();let session=session.clone();
                                tasks.spawn(async move{let (read,write)=stream.into_split();if let Err(error)=crate::connect(&server,&session,workspace,port,read,write).await{eprintln!("Forward: {error}");}});
                            }
                            _=tasks.join_next(),if !tasks.is_empty()=>{}
                        }
                    }
                    tasks.abort_all();
                }else{return Err("connect takes workspace-id port; forward also takes 127.0.0.1:local-port".into());}
            }
            Some("register") if args.len()==3=>{
                let id:Uuid=args[1].parse()?;
                let ports=args[2].split(',').map(str::parse).collect::<Result<BTreeSet<u16>,_>>()?;
                if ports.is_empty() || ports.len()>16 || ports.contains(&0){return Err("Allow 1-16 nonzero ports".into());}
                let root=crate::server_url(&server)?;
                let response=reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(std::time::Duration::from_secs(20)).build()?
                    .post(root.join(&format!("api/v2/workspaces/{id}/agent"))?).header("Coder-Session-Token",token("CODER_SESSION_TOKEN")?)
                    .json(&serde_json::json!({"ports":ports})).send().await?;
                if !response.status().is_success(){return Err(format!("Agent registration rejected: {}",response.status()).into());}
                // Registration deliberately emits the one-time credential for installation.
                println!("{}",response.text().await?);
            }
            _=>return Err("Usage: coder-network agent | register WORKSPACE PORTS | connect WORKSPACE PORT | forward WORKSPACE PORT 127.0.0.1:PORT".into()),
        }
        Ok(())
    }.await;
    signal.abort();
    result
}
