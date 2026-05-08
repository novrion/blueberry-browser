use std::path::PathBuf;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;

use sandbox_proto::{read_frame, write_frame, Request, Response, AGENT_VSOCK_PORT};

/// Talks to the in-VM agent over Firecracker's vsock UDS using the
/// host-initiated protocol: send `CONNECT <port>\n`, expect `OK <peer>\n`,
/// then exchange length-prefixed JSON frames.
pub struct VsockClient {
    uds: PathBuf,
}

impl VsockClient {
    pub fn new(uds: impl Into<PathBuf>) -> Self {
        Self { uds: uds.into() }
    }

    pub async fn wait_ready(&self, total: Duration) -> Result<()> {
        let deadline = Instant::now() + total;
        let mut backoff = Duration::from_millis(50);
        loop {
            match self.call(Request::Ping).await {
                Ok(Response::Pong) => return Ok(()),
                Ok(other) => return Err(anyhow!("unexpected ping response: {:?}", other)),
                Err(e) if Instant::now() >= deadline => {
                    return Err(e.context("agent ready timeout"));
                }
                Err(_) => {
                    tokio::time::sleep(backoff).await;
                    backoff = (backoff * 2).min(Duration::from_millis(500));
                }
            }
        }
    }

    pub async fn call(&self, req: Request) -> Result<Response> {
        let mut stream = UnixStream::connect(&self.uds)
            .await
            .with_context(|| format!("connect {:?}", self.uds))?;

        stream
            .write_all(format!("CONNECT {}\n", AGENT_VSOCK_PORT).as_bytes())
            .await?;
        read_connect_ack(&mut stream).await?;

        write_frame(&mut stream, &req).await.context("write_frame")?;
        let resp: Response = read_frame(&mut stream).await.context("read_frame")?;
        Ok(resp)
    }
}

async fn read_connect_ack(stream: &mut UnixStream) -> Result<()> {
    let mut ack = Vec::with_capacity(32);
    loop {
        let mut buf = [0u8; 1];
        let n = stream.read(&mut buf).await?;
        if n == 0 {
            return Err(anyhow!("eof during CONNECT ack"));
        }
        ack.push(buf[0]);
        if buf[0] == b'\n' {
            break;
        }
        if ack.len() > 64 {
            return Err(anyhow!("ack too long: {:?}", String::from_utf8_lossy(&ack)));
        }
    }
    let s = String::from_utf8_lossy(&ack);
    if !s.starts_with("OK ") {
        return Err(anyhow!("vsock connect refused: {:?}", s));
    }
    Ok(())
}
