use std::process::Stdio;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use base64::Engine;
use sandbox_proto::{read_frame, write_frame, Lang, Request, Response, AGENT_VSOCK_PORT};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio_vsock::{VsockAddr, VsockListener, VsockStream, VMADDR_CID_ANY};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();
    tracing::info!("guest agent starting on vsock port {}", AGENT_VSOCK_PORT);

    let mut listener = VsockListener::bind(VsockAddr::new(VMADDR_CID_ANY, AGENT_VSOCK_PORT))
        .context("vsock bind")?;

    loop {
        let (stream, peer) = listener.accept().await.context("vsock accept")?;
        tracing::debug!(?peer, "conn accepted");
        tokio::spawn(async move {
            if let Err(e) = handle(stream).await {
                tracing::warn!(err = %e, "client error");
            }
        });
    }
}

async fn handle(mut stream: VsockStream) -> Result<()> {
    let req: Request = read_frame(&mut stream).await?;
    let resp = match dispatch(req).await {
        Ok(r) => r,
        Err(e) => Response::Err {
            message: format!("{e:#}"),
        },
    };
    write_frame(&mut stream, &resp).await?;
    Ok(())
}

async fn dispatch(req: Request) -> Result<Response> {
    match req {
        Request::Ping => Ok(Response::Pong),
        Request::Exec {
            lang,
            code,
            timeout_ms,
        } => exec(lang, code, Duration::from_millis(timeout_ms)).await,
        Request::ReadFile { path } => read_file(path).await,
        Request::WriteFile { path, data_b64 } => write_file(path, data_b64).await,
    }
}

async fn exec(lang: Lang, code: String, timeout: Duration) -> Result<Response> {
    let mut cmd = match lang {
        Lang::Python => {
            let mut c = Command::new("python3");
            c.arg("-u").arg("-c").arg(&code);
            c
        }
        Lang::Bash => {
            let mut c = Command::new("/bin/sh");
            c.arg("-c").arg(&code);
            c
        }
    };
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd.spawn().context("spawn child")?;
    let mut out = child.stdout.take().ok_or_else(|| anyhow!("no stdout"))?;
    let mut err = child.stderr.take().ok_or_else(|| anyhow!("no stderr"))?;

    let collect = async {
        let mut so = Vec::new();
        let mut se = Vec::new();
        let so_fut = out.read_to_end(&mut so);
        let se_fut = err.read_to_end(&mut se);
        let (a, b) = tokio::join!(so_fut, se_fut);
        a?;
        b?;
        let status = child.wait().await?;
        Ok::<_, anyhow::Error>((so, se, status))
    };

    match tokio::time::timeout(timeout, collect).await {
        Ok(Ok((so, se, status))) => Ok(Response::ExecResult {
            stdout: String::from_utf8_lossy(&so).into_owned(),
            stderr: String::from_utf8_lossy(&se).into_owned(),
            exit_code: status.code().unwrap_or(-1),
        }),
        Ok(Err(e)) => Err(e),
        Err(_) => Ok(Response::ExecResult {
            stdout: String::new(),
            stderr: format!("exec timed out after {} ms", timeout.as_millis()),
            exit_code: 124,
        }),
    }
}

async fn read_file(path: String) -> Result<Response> {
    let bytes = tokio::fs::read(&path)
        .await
        .with_context(|| format!("read {path}"))?;
    let total = bytes.len() as u64;
    let data_b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(Response::FileData {
        bytes: total,
        data_b64,
    })
}

async fn write_file(path: String, data_b64: String) -> Result<Response> {
    let data = base64::engine::general_purpose::STANDARD
        .decode(data_b64.as_bytes())
        .context("decode b64")?;
    if let Some(parent) = std::path::Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            tokio::fs::create_dir_all(parent)
                .await
                .with_context(|| format!("mkdir {:?}", parent))?;
        }
    }
    tokio::fs::write(&path, &data)
        .await
        .with_context(|| format!("write {path}"))?;
    Ok(Response::Ok)
}
