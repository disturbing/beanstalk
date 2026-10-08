use actions_runner::app::{self, AppState};
use actions_runner::config::Config;
use actions_runner::telemetry;
use anyhow::Context;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    telemetry::init();
    let config = Config::from_env().context("loading config")?;
    let port = config.port();
    tracing::info!(
        port,
        work_root = %config.work_root().display(),
        executor = config.executor_url(),
        act = config.act_version(),
        image = config.image_version(),
        "listening"
    );
    let state = AppState::new(config).context("building the uplink")?;
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .with_context(|| format!("binding port {port}"))?;
    axum::serve(listener, app::router(state))
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("server error")
}

async fn shutdown_signal() {
    match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
        Ok(mut signal) => {
            signal.recv().await;
        }
        Err(error) => tracing::warn!(%error, "SIGTERM handler failed"),
    }
    tracing::info!("shutdown signal received");
}
