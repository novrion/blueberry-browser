use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub const AGENT_VSOCK_PORT: u32 = 1234;
pub const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Request {
    Ping,
    Exec {
        lang: Lang,
        code: String,
        timeout_ms: u64,
    },
    ReadFile {
        path: String,
    },
    WriteFile {
        path: String,
        data_b64: String,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum Lang {
    Python,
    Bash,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Response {
    Pong,
    ExecResult {
        stdout: String,
        stderr: String,
        exit_code: i32,
    },
    FileData {
        data_b64: String,
        bytes: u64,
    },
    Ok,
    Err {
        message: String,
    },
}

#[derive(Debug, Error)]
pub enum FrameError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("frame too large: {0} bytes (max {})", MAX_FRAME_BYTES)]
    TooLarge(usize),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("eof")]
    Eof,
}

pub async fn write_frame<W: AsyncWrite + Unpin, T: Serialize>(
    w: &mut W,
    msg: &T,
) -> Result<(), FrameError> {
    let bytes = serde_json::to_vec(msg)?;
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(FrameError::TooLarge(bytes.len()));
    }
    let len = bytes.len() as u32;
    w.write_all(&len.to_be_bytes()).await?;
    w.write_all(&bytes).await?;
    w.flush().await?;
    Ok(())
}

pub async fn read_frame<R: AsyncRead + Unpin, T: for<'de> Deserialize<'de>>(
    r: &mut R,
) -> Result<T, FrameError> {
    let mut len_buf = [0u8; 4];
    match r.read_exact(&mut len_buf).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Err(FrameError::Eof),
        Err(e) => return Err(FrameError::Io(e)),
    }
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > MAX_FRAME_BYTES {
        return Err(FrameError::TooLarge(len));
    }
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf).await?;
    Ok(serde_json::from_slice(&buf)?)
}
