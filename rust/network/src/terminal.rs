//! Interactive PTYs on the workspace agent. The browser cannot choose a shell or cwd.
use crate::{Socket, TIMEOUT, error};
use std::{io, path::PathBuf};

/// Explicit local opt-in to interactive shells, running as the workspace agent user.
#[derive(Clone)]
pub struct TerminalConfig {
    /// Absolute path to the interactive shell executable.
    pub shell: PathBuf,
    /// Absolute working directory for new shells.
    pub directory: PathBuf,
}
impl TerminalConfig {
    pub(crate) fn validate(&self) -> io::Result<()> {
        if !self.shell.is_absolute()
            || !self.shell.is_file()
            || !self.directory.is_absolute()
            || !self.directory.is_dir()
        {
            return Err(error(
                "Terminal shell and directory must be existing absolute paths",
            ));
        }
        Ok(())
    }
}

#[cfg(unix)]
mod unix {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
    use std::{
        io::{Read, Write},
        os::fd::{AsRawFd, RawFd},
        time::Duration,
    };
    use tokio::io::unix::AsyncFd;
    use tokio_tungstenite::tungstenite::Message;

    type Master = std::sync::Arc<std::sync::Mutex<Box<dyn MasterPty + Send>>>;
    struct Descriptor(Master);
    impl AsRawFd for Descriptor {
        fn as_raw_fd(&self) -> RawFd {
            self.0
                .lock()
                .expect("PTY master")
                .as_raw_fd()
                .expect("PTY fd")
        }
    }
    struct Pty {
        master: Master,
        reader: Box<dyn Read + Send>,
        writer: Box<dyn Write + Send>,
        child: Option<Box<dyn Child + Send + Sync>>,
    }
    impl Drop for Pty {
        fn drop(&mut self) {
            if let Some(mut child) = self.child.take() {
                // Terminate both foreground job and shell group, then reap the shell.
                if let Some(pid) = self
                    .master
                    .lock()
                    .expect("PTY master")
                    .process_group_leader()
                    .filter(|p| *p > 1)
                {
                    let _ = nix::sys::signal::killpg(
                        nix::unistd::Pid::from_raw(pid),
                        nix::sys::signal::Signal::SIGKILL,
                    );
                }
                if let Some(pid) = child.process_id().filter(|p| *p > 1) {
                    let _ = nix::sys::signal::killpg(
                        nix::unistd::Pid::from_raw(pid as i32),
                        nix::sys::signal::Signal::SIGKILL,
                    );
                }
                tokio::task::spawn_blocking(move || {
                    let _ = child.kill();
                    let _ = child.wait();
                });
            }
        }
    }
    fn open(config: &TerminalConfig) -> io::Result<Pty> {
        config.validate()?;
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|_| error("PTY unavailable"))?;
        let mut cmd = CommandBuilder::new(&config.shell);
        cmd.arg("-i");
        cmd.cwd(&config.directory);
        cmd.env_clear();
        // Never inherit the agent token, database URL, worker key, or arbitrary service secrets.
        for key in [
            "HOME", "USER", "LOGNAME", "PATH", "LANG", "LC_ALL", "LC_CTYPE",
        ] {
            if let Some(value) = std::env::var_os(key) {
                cmd.env(key, value);
            }
        }
        cmd.env("TERM", "xterm-256color");
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|_| error("PTY reader unavailable"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|_| error("PTY writer unavailable"))?;
        let fd = pair
            .master
            .as_raw_fd()
            .ok_or_else(|| error("PTY descriptor unavailable"))?;
        let flags = nix::fcntl::fcntl(fd, nix::fcntl::FcntlArg::F_GETFL)?;
        nix::fcntl::fcntl(
            fd,
            nix::fcntl::FcntlArg::F_SETFL(
                nix::fcntl::OFlag::from_bits_truncate(flags) | nix::fcntl::OFlag::O_NONBLOCK,
            ),
        )?;
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|_| error("Interactive shell could not start"))?;
        Ok(Pty {
            master: std::sync::Arc::new(std::sync::Mutex::new(pair.master)),
            reader,
            writer,
            child: Some(child),
        })
    }
    fn size(bytes: &[u8]) -> io::Result<PtySize> {
        if bytes.len() != 5 || bytes[0] != 1 {
            return Err(error("Invalid terminal resize"));
        }
        let rows = u16::from_be_bytes([bytes[1], bytes[2]]);
        let cols = u16::from_be_bytes([bytes[3], bytes[4]]);
        if !(2..=500).contains(&rows) || !(2..=500).contains(&cols) {
            return Err(error("Terminal size outside 2-500 cells"));
        }
        Ok(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
    }
    pub(super) async fn run(socket: Socket, config: TerminalConfig) -> io::Result<()> {
        let mut pty = open(&config)?;
        // Descriptor borrows the master; declaration order drops it before Pty.
        // The shared, immutable master handle keeps the descriptor alive while registered.
        // portable-pty exposes AsRawFd rather than AsFd, so register() is unavailable.
        #[allow(deprecated)]
        let descriptor = AsyncFd::new(Descriptor(pty.master.clone()))?;
        let (mut send, mut receive) = socket.split();
        let mut output = vec![0; 16 * 1024];
        let mut pending = Vec::new();
        let mut offset = 0;
        let mut tick = tokio::time::interval(Duration::from_secs(15));
        let mut last = tokio::time::Instant::now();
        loop {
            tokio::select! {
                readable=descriptor.readable()=>{
                    let mut ready=readable?;
                    match ready.try_io(|_|pty.reader.read(&mut output)) {
                        Ok(Ok(0))=>break,
                        Ok(Ok(n))=>tokio::time::timeout(TIMEOUT,send.send(Message::Binary(output[..n].to_vec().into()))).await.map_err(|_|error("Terminal output stalled"))?.map_err(|_|error("Terminal disconnected"))?,
                        Ok(Err(e)) if e.raw_os_error()==Some(nix::libc::EIO)=>break,
                        Ok(Err(e))=>return Err(e),
                        Err(_)=>{},
                    }
                }
                writable=descriptor.writable(),if offset<pending.len()=>{
                    let mut ready=writable?;
                    if let Ok(n)=ready.try_io(|_|pty.writer.write(&pending[offset..])) {let n=n?;if n==0 {return Err(error("Terminal input closed"));}offset+=n;}
                }
                incoming=receive.next(),if offset==pending.len()=>{
                    last=tokio::time::Instant::now();
                    match incoming {
                        Some(Ok(Message::Binary(bytes))) if bytes.first()==Some(&0) && bytes.len()>1=>{pending=bytes[1..].to_vec();offset=0;}
                        Some(Ok(Message::Binary(bytes))) if bytes.first()==Some(&1)=>pty.master.lock().expect("PTY master").resize(size(&bytes)?).map_err(|_|error("Terminal resize failed"))?,
                        Some(Ok(Message::Ping(bytes)))=>tokio::time::timeout(TIMEOUT,send.send(Message::Pong(bytes))).await.map_err(|_|error("Terminal heartbeat stalled"))?.map_err(|_|error("Terminal disconnected"))?,
                        Some(Ok(Message::Pong(_)))=>{},
                        Some(Ok(Message::Close(_)))|None=>return Ok(()),
                        _=>return Err(error("Invalid terminal input frame")),
                    }
                }
                _=tick.tick()=>{
                    if last.elapsed()>Duration::from_secs(60) {return Err(error("Terminal heartbeat expired"));}
                    tokio::time::timeout(TIMEOUT,send.send(Message::Ping(Vec::new().into()))).await.map_err(|_|error("Terminal heartbeat stalled"))?.map_err(|_|error("Terminal disconnected"))?;
                }
            }
        }
        let _ = tokio::time::timeout(TIMEOUT, send.send(Message::Text("eof".into()))).await;
        let _ = tokio::time::timeout(TIMEOUT, send.close()).await;
        Ok(())
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn rejects_invalid_terminal_dimensions() {
            assert_eq!(size(&[1, 0, 24, 0, 80]).unwrap().cols, 80);
            for frame in [
                vec![],
                vec![1, 0, 0, 0, 80],
                vec![1, 255, 255, 0, 80],
                vec![0, 0, 24, 0, 80],
            ] {
                assert!(size(&frame).is_err());
            }
        }
    }
}

pub(crate) async fn run(socket: Socket, config: TerminalConfig) -> io::Result<()> {
    #[cfg(unix)]
    {
        unix::run(socket, config).await
    }
    #[cfg(not(unix))]
    {
        let _ = (socket, config, TIMEOUT);
        Err(error(
            "Browser PTYs currently require a Unix workspace agent",
        ))
    }
}
