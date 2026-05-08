//! Tiny HTTP-over-UnixDomainSocket client for the Firecracker management API.

use std::path::Path;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::Request;
use serde_json::Value;
use tokio::net::UnixStream;

const REQ_TIMEOUT: Duration = Duration::from_secs(10);

pub async fn put(api_sock: &Path, route: &str, body: &Value) -> Result<()> {
    request("PUT", api_sock, route, Some(body)).await
}

pub async fn wait_for_socket(path: &Path, total: Duration) -> Result<()> {
    let deadline = std::time::Instant::now() + total;
    loop {
        if path.exists() {
            return Ok(());
        }
        if std::time::Instant::now() >= deadline {
            return Err(anyhow!("api socket {:?} did not appear", path));
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

async fn request(
    method: &'static str,
    api_sock: &Path,
    route: &str,
    body: Option<&Value>,
) -> Result<()> {
    let fut = async {
        let stream = UnixStream::connect(api_sock)
            .await
            .with_context(|| format!("connect {:?}", api_sock))?;
        let io = hyper_util::rt::TokioIo::new(stream);
        let (mut sender, conn) = hyper::client::conn::http1::handshake(io)
            .await
            .context("handshake")?;
        let conn_task = tokio::spawn(async move {
            let _ = conn.await;
        });

        let body_bytes = match body {
            Some(v) => serde_json::to_vec(v)?,
            None => Vec::new(),
        };
        let req = Request::builder()
            .method(method)
            .uri(route)
            .header("Host", "localhost")
            .header("Accept", "application/json")
            .header("Content-Type", "application/json")
            .body(Full::new(Bytes::from(body_bytes)))?;

        let resp = sender.send_request(req).await.context("send_request")?;
        let status = resp.status();
        let resp_body = resp.into_body().collect().await?.to_bytes();
        conn_task.abort();

        if !status.is_success() {
            return Err(anyhow!(
                "fc {} {} → {} body={}",
                method,
                route,
                status,
                String::from_utf8_lossy(&resp_body)
            ));
        }
        Ok(())
    };

    tokio::time::timeout(REQ_TIMEOUT, fut)
        .await
        .map_err(|_| anyhow!("fc api {} {} timed out", method, route))?
}
