use anyhow::Context;
use runner::app::{self, AppState};
use runner::config::Config;
use runner::telemetry;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    telemetry::init();
    let config = Config::from_env().context("loading config")?;
    let state = AppState::prepare(&config)
        .await
        .context("preparing the work directory")?;
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", config.port()))
        .await
        .with_context(|| format!("binding port {}", config.port()))?;
    tracing::info!(
        port = config.port(),
        work_dir = %config.work_dir().display(),
        remote_schemes = %config.remote_schemes(),
        deployment = config.deployment_id(),
        git = state.tools().git(),
        node = state.tools().node(),
        suite_network = state.suite_network(),
        deps_dir = %config.deps_dir().display(),
        "listening"
    );
    axum::serve(listener, app::router(state))
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("server error")
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::warn!(%error, "ctrl_c handler failed");
        }
    };
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => tracing::warn!(%error, "SIGTERM handler failed"),
        }
    };
    tokio::select! {
        () = ctrl_c => {}
        () = terminate => {}
    }
    tracing::info!("shutdown signal received");
}
