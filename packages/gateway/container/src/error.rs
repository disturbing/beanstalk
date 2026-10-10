//! The runner's error type and its HTTP mapping.

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use thiserror::Error;

/// Every failure the runner reports. Tokens never appear in any variant: git output is redacted
/// before it is stored here.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum Error {
    #[error("invalid request: {0}")]
    InvalidRequest(String),

    #[error("commit {sha} is not reachable from the named refs of {repo}")]
    UnknownCommit { sha: String, repo: String },

    #[error("ref {reference} does not exist in {repo}")]
    UnknownRef { reference: String, repo: String },

    #[error("commits {left} and {right} have no common ancestor")]
    NoMergeBase { left: String, right: String },

    #[error("commit {sha} has no parent to revert to")]
    RootCommit { sha: String },

    #[error("git {op} against {repo} failed: {detail}")]
    Remote {
        op: &'static str,
        repo: String,
        detail: String,
    },

    #[error("{op} timed out after {seconds} s")]
    Timeout { op: &'static str, seconds: u64 },

    #[error("git {op} failed: {detail}")]
    Git { op: &'static str, detail: String },

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

    fn status_and_code(&self) -> (StatusCode, &'static str) {
        match self {
            Self::InvalidRequest(_) => (StatusCode::BAD_REQUEST, "invalid_request"),
            Self::UnknownCommit { .. } => (StatusCode::UNPROCESSABLE_ENTITY, "unknown_commit"),
            Self::UnknownRef { .. } => (StatusCode::UNPROCESSABLE_ENTITY, "unknown_ref"),
            Self::NoMergeBase { .. } => (StatusCode::UNPROCESSABLE_ENTITY, "no_merge_base"),
            Self::RootCommit { .. } => (StatusCode::UNPROCESSABLE_ENTITY, "root_commit"),
            Self::Remote { .. } => (StatusCode::BAD_GATEWAY, "remote_failed"),
            Self::Timeout { .. } => (StatusCode::GATEWAY_TIMEOUT, "timeout"),
            Self::Git { .. } | Self::Io { .. } | Self::Config(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "internal")
            }
        }
    }

    /// Remote and timeout failures concern the caller's own remote (already redacted), so the
    /// caller gets the detail; other server errors stay in the logs.
    fn is_shareable(&self) -> bool {
        !matches!(self, Self::Git { .. } | Self::Io { .. } | Self::Config(_))
    }
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    code: &'static str,
    message: String,
}

impl IntoResponse for Error {
    fn into_response(self) -> Response {
        let (status, code) = self.status_and_code();
        if status.is_server_error() {
            tracing::error!(error = %self, code, "request failed");
        } else {
            tracing::warn!(error = %self, code, "request rejected");
        }
        let message = if self.is_shareable() {
            self.to_string()
        } else {
            "internal error".to_owned()
        };
        (status, Json(ErrorBody { code, message })).into_response()
    }
}

impl From<JsonRejection> for Error {
    fn from(rejection: JsonRejection) -> Self {
        Self::InvalidRequest(rejection.body_text())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn internal_failures_hide_their_detail() {
        let error = Error::Git {
            op: "merge-tree",
            detail: "fatal: /work/abc.git is corrupt".to_owned(),
        };

        assert!(!error.is_shareable());
        assert_eq!(error.status_and_code().1, "internal");
    }

    #[test]
    fn remote_failures_reach_the_caller() {
        let error = Error::Remote {
            op: "fetch",
            repo: "https://example.invalid/r.git".to_owned(),
            detail: "HTTP 401".to_owned(),
        };

        assert!(error.is_shareable());
        assert_eq!(error.status_and_code().0, StatusCode::BAD_GATEWAY);
    }
}
