use anyhow::Context;
use ssh_server::config::Config;
use ssh_server::gateway::HttpGateway;
use ssh_server::git::bridge::BridgeLimits;
use ssh_server::health::{self, HostKeyInfo};
use ssh_server::ssh::{Shared, SshServer, host_key_fingerprint, russh_config};
use ssh_server::telemetry;

/// One fetch request's wants and haves; git sends haves in rounds, so this is generous.
const MAX_FETCH_REQUEST_BYTES: usize = 16 * 1024 * 1024;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    telemetry::init();
    let config = Config::from_env().context("loading config")?;
    let host_key = HostKeyInfo {
        algorithm: config.host_key.algorithm().to_string(),
        fingerprint: host_key_fingerprint(&config.host_key),
    };
    let gateway = HttpGateway::new(&config.gateway_url).context("building the gateway client")?;
    let shared = Shared {
        gateway,
        bridge: BridgeLimits {
            max_push_bytes: config.limits.max_push_bytes,
            max_request_bytes: MAX_FETCH_REQUEST_BYTES,
        },
    };
    let server = SshServer::new(
        russh_config(config.host_key.clone(), &config.limits),
        shared,
        &config.limits,
    );
    let ssh_listener = tokio::net::TcpListener::bind(("0.0.0.0", config.ssh_port))
        .await
        .with_context(|| format!("binding SSH port {}", config.ssh_port))?;
    let health_listener = tokio::net::TcpListener::bind(("0.0.0.0", config.health_port))
        .await
        .with_context(|| format!("binding health port {}", config.health_port))?;
    tracing::info!(
        ssh_port = config.ssh_port,
        health_port = config.health_port,
        host_key = %host_key.fingerprint,
        max_sessions = config.limits.max_sessions,
        deployment = config.deployment_id.as_deref(),
        "listening"
    );
    let health = axum::serve(health_listener, health::router(host_key));
    tokio::select! {
        result = server.run(ssh_listener) => result.context("SSH listener failed"),
        result = health.into_future() => result.context("health server failed"),
        () = shutdown_signal() => Ok(()),
    }
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
