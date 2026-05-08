use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ApiError {
    #[error("not found")]
    NotFound,
    #[error("capacity reached")]
    Capacity,
    #[error("agent error: {0}")]
    Agent(String),
    #[error("timeout")]
    Timeout,
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("internal: {0}")]
    Internal(#[from] anyhow::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code) = match &self {
            ApiError::NotFound => (StatusCode::NOT_FOUND, "not_found"),
            ApiError::Capacity => (StatusCode::SERVICE_UNAVAILABLE, "capacity"),
            ApiError::Agent(_) => (StatusCode::BAD_GATEWAY, "agent_error"),
            ApiError::Timeout => (StatusCode::GATEWAY_TIMEOUT, "timeout"),
            ApiError::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            ApiError::Internal(_) | ApiError::Io(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "internal")
            }
        };
        if matches!(self, ApiError::Internal(_) | ApiError::Io(_)) {
            tracing::error!(err = %self, "request failed");
        }
        let body = Json(json!({ "error": code, "message": self.to_string() }));
        (status, body).into_response()
    }
}
