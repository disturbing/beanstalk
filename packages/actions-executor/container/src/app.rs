//! The HTTP surface the executor's Durable Object calls: start the one job, cancel it, read its
//! status (the fallback when the result could not be posted).

use std::sync::{Arc, Mutex, PoisonError};

use axum::extract::rejection::JsonRejection;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum::middleware;
use axum::response::Response;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;
use tokio::sync::watch;

use crate::act::command;
use crate::config::Config;
use crate::error::{Error, Result};
use crate::job;
use crate::uplink::HttpUplink;
use crate::wire::{
    API_VERSION, CancelRequest, JobRequest, StatusResponse, StopReason, VersionResponse,
};

/// Response header carrying [`API_VERSION`].
pub const API_VERSION_HEADER: &str = "x-beanstalk-actions-runner-api";
/// Event payloads and secrets are small; 8 MiB bounds a bad caller.
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(status))
        .route("/version", get(version))
        .route("/v1/status", get(status))
        .route("/v1/job", post(start))
        .route("/v1/cancel", post(cancel))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(middleware::map_response(stamp_api_version))
        .with_state(state)
}

async fn stamp_api_version(mut response: Response) -> Response {
    response.headers_mut().insert(
        HeaderName::from_static(API_VERSION_HEADER),
        HeaderValue::from(API_VERSION),
    );
    response
}

/// Shared state: the configuration, the uplink, and the container's one job slot.
#[derive(Debug, Clone)]
pub struct AppState {
    shared: Arc<Shared>,
}

#[derive(Debug)]
struct Shared {
    config: Config,
    uplink: HttpUplink,
    slot: Mutex<StatusResponse>,
    stop: watch::Sender<Option<StopReason>>,
}

impl AppState {
    /// # Errors
    ///
    /// [`Error::Config`] when the uplink cannot be built.
    pub fn new(config: Config) -> Result<Self> {
        let uplink = HttpUplink::new(config.executor_url())?;
        let (stop, _) = watch::channel(None);
        Ok(Self {
            shared: Arc::new(Shared {
                config,
                uplink,
                slot: Mutex::new(StatusResponse::Idle),
                stop,
            }),
        })
    }

    fn slot(&self) -> std::sync::MutexGuard<'_, StatusResponse> {
        self.shared
            .slot
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

async fn version(State(state): State<AppState>) -> Json<VersionResponse> {
    let config = &state.shared.config;
    Json(VersionResponse {
        api_version: API_VERSION,
        act_version: config.act_version().to_owned(),
        image_version: config.image_version().to_owned(),
    })
}

async fn status(State(state): State<AppState>) -> Json<StatusResponse> {
    Json(state.slot().clone())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Accepted {
    job_id: String,
    accepted: bool,
}

/// Starts the job in the background. A container runs one job only: a second request is
/// refused, whatever state the first is in.
async fn start(
    State(state): State<AppState>,
    body: std::result::Result<Json<JobRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<Accepted>)> {
    let Json(request) = body.map_err(|rejection| Error::InvalidRequest(rejection.body_text()))?;
    command::validate(&request)?;
    let job_id = request.job_id.clone();
    {
        let mut slot = state.slot();
        if !matches!(*slot, StatusResponse::Idle) {
            return Err(Error::AlreadyUsed);
        }
        *slot = StatusResponse::Running {
            job_id: job_id.clone(),
            started_at: job::now_ms(),
        };
    }
    tracing::info!(job_id, job = request.job_name, "job accepted");
    let runner = state.clone();
    tokio::spawn(async move {
        let shared = &runner.shared;
        let stop = shared.stop.subscribe();
        let result = job::run(&shared.config, &shared.uplink, request, stop).await;
        tracing::info!(job_id = result.job_id, conclusion = ?result.conclusion, "job finished");
        *runner.slot() = StatusResponse::Finished {
            result: Box::new(result),
        };
    });
    Ok((
        StatusCode::ACCEPTED,
        Json(Accepted {
            job_id,
            accepted: true,
        }),
    ))
}

async fn cancel(
    State(state): State<AppState>,
    body: std::result::Result<Json<CancelRequest>, JsonRejection>,
) -> Result<StatusCode> {
    let Json(request) = body.map_err(|rejection| Error::InvalidRequest(rejection.body_text()))?;
    if !matches!(*state.slot(), StatusResponse::Running { .. }) {
        return Err(Error::NotRunning);
    }
    state.shared.stop.send_replace(Some(request.reason));
    Ok(StatusCode::ACCEPTED)
}
