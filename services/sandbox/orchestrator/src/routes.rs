use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use base64::Engine;
use serde::{Deserialize, Serialize};
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use uuid::Uuid;

use crate::error::ApiError;
use crate::registry::Registry;
use sandbox_proto::Lang;

pub fn router(reg: Arc<Registry>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/sandbox", post(create_sandbox))
        .route("/sandbox/:id", delete(kill_sandbox))
        .route("/sandbox/:id/exec", post(exec))
        .route("/sandbox/:id/file", get(read_file).put(write_file))
        .route("/sandbox/:id/timeout", post(set_timeout))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(reg)
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true }))
}

#[derive(Debug, Deserialize)]
struct CreateReq {
    timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
struct CreateResp {
    id: Uuid,
}

async fn create_sandbox(
    State(reg): State<Arc<Registry>>,
    Json(req): Json<CreateReq>,
) -> Result<Json<CreateResp>, ApiError> {
    let vm = reg.create(req.timeout_ms).await?;
    Ok(Json(CreateResp { id: vm.id }))
}

async fn kill_sandbox(
    State(reg): State<Arc<Registry>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let vm = reg.remove(id).await.ok_or(ApiError::NotFound)?;
    vm.shutdown().await;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ExecLang {
    Python,
    Bash,
}

impl From<ExecLang> for Lang {
    fn from(v: ExecLang) -> Lang {
        match v {
            ExecLang::Python => Lang::Python,
            ExecLang::Bash => Lang::Bash,
        }
    }
}

#[derive(Debug, Deserialize)]
struct ExecReq {
    lang: ExecLang,
    code: String,
    timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
struct ExecResp {
    stdout: String,
    stderr: String,
    exit_code: i32,
}

async fn exec(
    State(reg): State<Arc<Registry>>,
    Path(id): Path<Uuid>,
    Json(req): Json<ExecReq>,
) -> Result<Json<ExecResp>, ApiError> {
    let vm = reg.get(id).await?;
    let timeout = clamp_timeout(req.timeout_ms, &reg);
    let r = vm.exec(req.lang.into(), req.code, timeout).await?;
    Ok(Json(ExecResp {
        stdout: r.stdout,
        stderr: r.stderr,
        exit_code: r.exit_code,
    }))
}

#[derive(Debug, Deserialize)]
struct FileQ {
    path: String,
}

#[derive(Debug, Serialize)]
struct FileResp {
    path: String,
    bytes: u64,
    data_b64: String,
}

async fn read_file(
    State(reg): State<Arc<Registry>>,
    Path(id): Path<Uuid>,
    Query(q): Query<FileQ>,
) -> Result<Json<FileResp>, ApiError> {
    let vm = reg.get(id).await?;
    let r = vm.read_file(q.path.clone()).await?;
    Ok(Json(FileResp {
        path: q.path,
        bytes: r.bytes,
        data_b64: r.data_b64,
    }))
}

#[derive(Debug, Deserialize)]
struct WriteReq {
    path: String,
    data_b64: String,
}

async fn write_file(
    State(reg): State<Arc<Registry>>,
    Path(id): Path<Uuid>,
    Json(req): Json<WriteReq>,
) -> Result<StatusCode, ApiError> {
    let vm = reg.get(id).await?;
    base64::engine::general_purpose::STANDARD
        .decode(&req.data_b64)
        .map_err(|e| ApiError::BadRequest(format!("data_b64: {e}")))?;
    vm.write_file(req.path, req.data_b64).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
struct TimeoutReq {
    timeout_ms: u64,
}

async fn set_timeout(
    State(reg): State<Arc<Registry>>,
    Path(id): Path<Uuid>,
    Json(req): Json<TimeoutReq>,
) -> Result<StatusCode, ApiError> {
    let vm = reg.get(id).await?;
    let dur = Duration::from_millis(req.timeout_ms).min(reg.cfg.max_timeout);
    vm.bump_deadline(dur);
    Ok(StatusCode::NO_CONTENT)
}

fn clamp_timeout(req: Option<u64>, reg: &Registry) -> Duration {
    let cfg = &reg.cfg;
    req.map(Duration::from_millis)
        .unwrap_or(cfg.default_timeout)
        .min(cfg.max_timeout)
}
