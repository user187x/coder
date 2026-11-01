//! WireGuard Noise IK packets over the authenticated, ordered WebSocket relay.
//! Each connection has fresh keys and fixed private IPs; no host routes or TUN privileges.
use crate::{Socket, TIMEOUT, error};
use boringtun::{
    noise::{Tunn, TunnResult},
    x25519::{PublicKey, StaticSecret},
};
use futures_util::{SinkExt, StreamExt};
use std::{io, time::Duration};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio_tungstenite::tungstenite::Message;

pub(crate) struct Key(StaticSecret);
impl Key {
    pub fn new() -> Self {
        Self(StaticSecret::random_from_rng(rand_core::OsRng))
    }
    pub fn public(&self) -> String {
        PublicKey::from(&self.0)
            .as_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }
}
fn peer(value: &str) -> io::Result<PublicKey> {
    if value.len() != 64 || !value.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err(error("Invalid WireGuard public key"));
    }
    let mut key = [0; 32];
    for (i, b) in key.iter_mut().enumerate() {
        *b = u8::from_str_radix(&value[i * 2..i * 2 + 2], 16)
            .map_err(|_| error("Invalid WireGuard public key"))?;
    }
    if key == [0; 32] {
        return Err(error("Invalid WireGuard public key"));
    }
    Ok(PublicKey::from(key))
}
fn checksum(data: &[u8]) -> u16 {
    let mut sum: u32 = data
        .chunks_exact(2)
        .map(|b| u32::from(u16::from_be_bytes([b[0], b[1]])))
        .sum();
    while sum > 0xffff {
        sum = (sum & 0xffff) + (sum >> 16);
    }
    !(sum as u16)
}
// IP protocol 253 is for experimentation. Records are not routable general IP traffic.
fn packet(client: bool, kind: u8, sequence: u64, data: &[u8]) -> Vec<u8> {
    let mut p = vec![0; 29 + data.len()];
    p[0] = 0x45;
    let len = p.len() as u16;
    p[2..4].copy_from_slice(&len.to_be_bytes());
    p[8] = 64;
    p[9] = 253;
    p[12..16].copy_from_slice(&[10, 253, 0, if client { 1 } else { 2 }]);
    p[16..20].copy_from_slice(&[10, 253, 0, if client { 2 } else { 1 }]);
    let check = checksum(&p[..20]);
    p[10..12].copy_from_slice(&check.to_be_bytes());
    p[20] = kind;
    p[21..29].copy_from_slice(&sequence.to_be_bytes());
    p[29..].copy_from_slice(data);
    p
}
fn record(packet: &[u8], client: bool) -> io::Result<(u8, u64, &[u8])> {
    if packet.len() < 29
        || packet[0] != 0x45
        || usize::from(u16::from_be_bytes([packet[2], packet[3]])) != packet.len()
        || packet[6..8] != [0, 0]
        || packet[9] != 253
        || checksum(&packet[..20]) != 0
        || packet[12..16] != [10, 253, 0, if client { 2 } else { 1 }]
        || packet[16..20] != [10, 253, 0, if client { 1 } else { 2 }]
    {
        return Err(error("Invalid WireGuard stream address or packet"));
    }
    Ok((
        packet[20],
        u64::from_be_bytes(packet[21..29].try_into().expect("record length")),
        &packet[29..],
    ))
}
async fn send<S>(sink: &mut S, message: Message) -> io::Result<()>
where
    S: futures_util::Sink<Message> + Unpin,
{
    tokio::time::timeout(TIMEOUT, sink.send(message))
        .await
        .map_err(|_| error("WireGuard relay stalled"))?
        .map_err(|_| error("WireGuard relay closed"))
}

pub(crate) async fn bridge<R: AsyncRead + Unpin, W: AsyncWrite + Unpin>(
    socket: Socket,
    key: Key,
    remote: &str,
    client: bool,
    mut input: R,
    mut output: W,
) -> io::Result<()> {
    let mut tunnel = Tunn::new(
        key.0,
        peer(remote)?,
        None,
        Some(15),
        rand_core::RngCore::next_u32(&mut rand_core::OsRng),
        None,
    );
    let (mut sink, mut source) = socket.split();
    let mut scratch = vec![0; 65536];
    let mut buffer = vec![0; 16 * 1024];
    let (mut sent, mut received) = (0u64, 0u64);
    let (mut read_eof, mut write_eof) = (false, false);
    let mut ready = false;
    let start = tokio::time::Instant::now();
    let mut last = start;
    let mut timer = tokio::time::interval(Duration::from_secs(1));
    if client {
        match tunnel.encapsulate(&packet(client, 2, 0, &[]), &mut scratch) {
            TunnResult::WriteToNetwork(p) => {
                send(&mut sink, Message::Binary(p.to_vec().into())).await?
            }
            _ => return Err(error("WireGuard handshake could not start")),
        }
    }
    loop {
        if read_eof && write_eof {
            let _ = tokio::time::timeout(TIMEOUT, sink.close()).await;
            return Ok(());
        }
        tokio::select! {
            read=input.read(&mut buffer),if ready && !read_eof=>{
                let n=read?;read_eof=n==0;
                let data=packet(client,if read_eof {1}else{0},sent,&buffer[..n]);sent=sent.checked_add(1).ok_or_else(||error("Stream limit reached"))?;
                match tunnel.encapsulate(&data,&mut scratch) {
                    TunnResult::WriteToNetwork(p)=>send(&mut sink,Message::Binary(p.to_vec().into())).await?,
                    TunnResult::Done=>{},
                    _=>return Err(error("WireGuard encryption failed")),
                }
            }
            incoming=source.next()=>{
                last=tokio::time::Instant::now();
                let bytes=match incoming {
                    Some(Ok(Message::Binary(b)))=>b,
                    Some(Ok(Message::Ping(b)))=>{send(&mut sink,Message::Pong(b)).await?;continue;}
                    Some(Ok(Message::Pong(_)))=>continue,
                    Some(Ok(Message::Close(_)))|None if write_eof=>return Ok(()),
                    _=>return Err(error("WireGuard relay disconnected")),
                };
                let mut datagram=bytes.as_ref();
                loop {
                    match tunnel.decapsulate(None,datagram,&mut scratch) {
                        TunnResult::Done=>break,
                        TunnResult::WriteToNetwork(p)=>send(&mut sink,Message::Binary(p.to_vec().into())).await?,
                        TunnResult::WriteToTunnelV4(p,_)=>{
                            let(kind,seq,payload)=record(p,client)?;
                            if kind==2 && !ready && seq==0 && payload.is_empty() {
                                ready=true;
                                if !client {
                                    match tunnel.encapsulate(&packet(client,2,0,&[]),&mut scratch) {
                                        TunnResult::WriteToNetwork(p)=>send(&mut sink,Message::Binary(p.to_vec().into())).await?,
                                        _=>return Err(error("WireGuard acknowledgement failed")),
                                    }
                                }
                            }
                            else {
                                if !ready || write_eof || seq!=received {return Err(error("WireGuard stream sequence rejected"));}
                                received=received.checked_add(1).ok_or_else(||error("Stream limit reached"))?;
                                match kind {
                                    0 if !payload.is_empty()=>{tokio::time::timeout(TIMEOUT,output.write_all(payload)).await.map_err(|_|error("Local stream stalled"))??;tokio::time::timeout(TIMEOUT,output.flush()).await.map_err(|_|error("Local stream stalled"))??;}
                                    1 if payload.is_empty()=>{write_eof=true;tokio::time::timeout(TIMEOUT,output.shutdown()).await.map_err(|_|error("Local stream stalled"))??;}
                                    _=>return Err(error("Invalid WireGuard stream record")),
                                }
                            }
                        }
                        _=>return Err(error("WireGuard authentication rejected")),
                    }
                    datagram=&[];
                }
            }
            _=timer.tick()=>{
                if !ready && start.elapsed()>Duration::from_secs(20) || last.elapsed()>Duration::from_secs(60) {return Err(error("WireGuard handshake or heartbeat expired"));}
                match tunnel.update_timers(&mut scratch) {
                    TunnResult::WriteToNetwork(p)=>send(&mut sink,Message::Binary(p.to_vec().into())).await?,
                    TunnResult::Done=>{},
                    _=>return Err(error("WireGuard session expired")),
                }
                send(&mut sink,Message::Ping(Vec::new().into())).await?;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_addresses_lengths_keys_and_record_data() {
        let original = packet(true, 0, 42, b"private bytes");
        assert_eq!(
            record(&original, false).unwrap(),
            (0, 42, b"private bytes".as_slice())
        );
        assert!(record(&original, true).is_err());
        for i in [0, 2, 6, 9, 10, 12, 16] {
            let mut p = original.clone();
            p[i] ^= 1;
            assert!(record(&p, false).is_err());
        }
        for key in ["", "x", &"0".repeat(64), &"z".repeat(64)] {
            assert!(peer(key).is_err());
        }
        assert!(peer(&Key::new().public()).is_ok());
    }
    #[test]
    fn wireguard_authenticates_encrypts_and_rejects_replay() {
        let a = Key::new();
        let b = Key::new();
        let ap = peer(&a.public()).unwrap();
        let bp = peer(&b.public()).unwrap();
        let mut a = Tunn::new(a.0, bp, None, None, 1, None);
        let mut b = Tunn::new(b.0, ap, None, None, 2, None);
        let mut out = [0; 2048];
        let mut tmp = [0; 2048];
        let data = packet(true, 0, 0, b"a secret not visible at the relay");
        let TunnResult::WriteToNetwork(init) = a.encapsulate(&data, &mut out) else {
            panic!("init")
        };
        let TunnResult::WriteToNetwork(response) = b.decapsulate(None, init, &mut tmp) else {
            panic!("response")
        };
        let _ = a.decapsulate(None, response, &mut out);
        let TunnResult::WriteToNetwork(encrypted) = a.decapsulate(None, &[], &mut out) else {
            panic!("queued packet")
        };
        assert!(!encrypted.windows(8).any(|p| p == b"a secret"));
        let encrypted = encrypted.to_vec();
        let TunnResult::WriteToTunnelV4(clear, _) = b.decapsulate(None, &encrypted, &mut tmp)
        else {
            panic!("decrypt")
        };
        assert_eq!(clear, data);
        assert!(matches!(
            b.decapsulate(None, &encrypted, &mut tmp),
            TunnResult::Err(_)
        ));
        let mut corrupt = encrypted;
        corrupt[20] ^= 0x40;
        assert!(matches!(
            b.decapsulate(None, &corrupt, &mut tmp),
            TunnResult::Err(_)
        ));
    }
}
