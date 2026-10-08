//! The job runner's error type and its HTTP mapping.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use thiserror::Error;

/// Every failure the job runner reports. No variant ever holds a secret or the job token:
/// messages are masked before they are built.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum Error {
    #[error("invalid request: {0}")]
    InvalidRequest(String),

    #[error("this container already ran a job; a container is never given a second one")]
    AlreadyUsed,

    #[error("no job is running")]
    NotRunning,

    #[error("the workflow is unusable: {0}")]
    Workflow(String),

    #[error("not supported here: {0}")]
    Unsupported(String),

    #[error("fetching the workflow file failed: {0}")]
    Fetch(String),

    #[error("{op} timed out after {seconds} s")]
    Timeout { op: &'static str, seconds: u64 },

    #[error("posting to the executor failed: {0}")]
    Uplink(String),

    #[error("{context}")]
    Io {
        context: String,
        #[source]
        source: std::io::Error,
    },

    #[error("invalid config: {0}")]
    Config(String),
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

impl Error {
    pub(crate) fn io(context: impl Into<String>) -> impl FnOnce(std::io::Error) -> Self {
        let context = context.into();
        move |source| Self::Io { context, source }
    }

    fn status(&self) -> StatusCode {
        match self {
            Self::InvalidRequest(_) | Self::Workflow(_) | Self::Unsupported(_) => {
                StatusCode::BAD_REQUEST
            }
            Self::AlreadyUsed | Self::NotRunning => StatusCode::CONFLICT,
            Self::Fetch(_) | Self::Uplink(_) => StatusCode::BAD_GATEWAY,
            Self::Timeout { .. } => StatusCode::GATEWAY_TIMEOUT,
            Self::Io { .. } | Self::Config(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn code(&self) -> &'static str {
        match self {
            Self::InvalidRequest(_) => "invalid_request",
            Self::AlreadyUsed => "already_used",
            Self::NotRunning => "not_running",
            Self::Workflow(_) => "workflow_unusable",
            Self::Unsupported(_) => "unsupported",
            Self::Fetch(_) => "fetch_failed",
            Self::Timeout { .. } => "timeout",
            Self::Uplink(_) => "uplink_failed",
            Self::Io { .. } => "io",
            Self::Config(_) => "config",
        }
    }
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    error: ErrorDetail<'a>,
}

#[derive(Serialize)]
struct ErrorDetail<'a> {
    code: &'a str,
    message: String,
}

impl IntoResponse for Error {
    fn into_response(self) -> Response {
        let status = self.status();
        if status.is_server_error() {
            tracing::error!(error = %self, "request failed");
        }
        let body = ErrorBody {
            error: ErrorDetail {
                code: self.code(),
                message: self.to_string(),
            },
        };
        (status, Json(body)).into_response()
    }
}
