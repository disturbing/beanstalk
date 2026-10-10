//! The HTTP side port: `GET /healthz` (the Container class waits for it before forwarding TCP,
//! since its readiness probe speaks HTTP and SSH does not) and `GET /host-key` (the public
//! fingerprint, never the key).

use axum::Router;
use axum::extract::State;
use axum::routing::get;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct HostKeyInfo {
    pub algorithm: String,
    pub fingerprint: String,
}

/// The health router.
pub fn router(host_key: HostKeyInfo) -> Router {
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/host-key", get(host_key_info))
        .with_state(host_key)
}

async fn host_key_info(State(info): State<HostKeyInfo>) -> axum::Json<HostKeyInfo> {
    axum::Json(info)
}
