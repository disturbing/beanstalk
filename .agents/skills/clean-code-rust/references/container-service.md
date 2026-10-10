# Rust service in a Cloudflare Container

## Contents
- Runtime facts
- main.rs skeleton
- Config, telemetry, routes
- Dockerfile
- Owning Worker

## Runtime facts

- Containers run `linux/amd64` images that `wrangler deploy` builds with the local Docker daemon. A Durable Object in a TypeScript Worker starts, addresses and stops each instance. Platform details: the `cloudflare` skill, `references/containers/`.
- The DO forwards HTTP to the port in `defaultPort`; the process must bind `0.0.0.0`. Read the port from `PORT`, which the Container class sets in `envVars`.
- Stop sends a signal (SIGTERM by default) and then kills. Finish in-flight work and exit within a few seconds.
- Disk is ephemeral and an instance can restart at any time. Durable data goes to R2, D1, DO storage or Artifacts, never the container filesystem.
- stdout and stderr go to Workers Logs. Emit one JSON object per line.
- `CLOUDFLARE_DEPLOYMENT_ID` and other `CLOUDFLARE_*` variables identify the instance; log them at startup.
- Sizes run from `lite` (1/16 vCPU, 256 MiB, 2 GB disk) to `standard-4` (4 vCPU, 12 GiB, 20 GB). Pick the smallest that passes the bench and set it as `instance_type` in the owning Worker's config.

## main.rs skeleton

```rust
use anyhow::Context;
use world_builder::{app, config::Config, telemetry};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    telemetry::init();
    let config = Config::from_env().context("loading config")?;
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", config.port))
        .await
        .with_context(|| format!("binding port {}", config.port))?;
    tracing::info!(port = config.port, deployment = %config.deployment_id, "listening");
    axum::serve(listener, app::router(config))
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
```

## Config, telemetry, routes

- `Config::from_env()` reads every variable once, parses into typed fields (`u16`, `Duration`, newtypes) and returns one `Err` listing every missing or invalid name. No other `std::env::var` call exists in the crate.
- `telemetry::init()`: `tracing_subscriber` with `EnvFilter` from `RUST_LOG` (default `info`) and the `json()` formatter. `#[tracing::instrument(skip(state), fields(bean = %id))]` on handlers and domain entry points so every log line carries the ids.
- Every service exposes `GET /healthz` (200 once ready) and `GET /version` (git sha baked in at build time through an env var or `build.rs`).
- Handlers are thin: deserialize a `wire` type, call one domain function, map the `Result`. Business logic never imports axum.
- Long jobs (a world composition, a merge) run as a task with a `CancellationToken`, report progress over a channel, and return a job id at once when the caller cannot wait.

## Dockerfile

The build context is the repo root so the Cargo workspace and `Cargo.lock` are visible; the root `.dockerignore` keeps `node_modules`, `target`, `.git`, `docs` and `research` out.

```dockerfile
# syntax=docker/dockerfile:1
FROM --platform=linux/amd64 rust:1-slim-bookworm AS chef
RUN cargo install cargo-chef --locked
WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release -p world-builder --recipe-path recipe.json
COPY . .
RUN cargo build --release -p world-builder

# Pure-Rust service: distroless. A service that shells out (git, mergiraf) uses
# debian:bookworm-slim here and installs those tools with apt-get in this stage.
FROM --platform=linux/amd64 gcr.io/distroless/cc-debian12:nonroot
COPY --from=builder /app/target/release/world-builder /usr/local/bin/world-builder
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/world-builder"]
```

Pin `rust:1-slim-bookworm` to the exact version from `rust-toolchain.toml` once chosen. Keep the final image free of the toolchain. If a source change does not show up under `wrangler dev`, the cached image is stale: `docker rmi` it.

## Owning Worker

The container is reached only through its Container class in a TypeScript Worker package (`gitstalk-packages` skill, `references/rust-container-package.md`). The Rust crate knows nothing about Cloudflare bindings: it receives plain HTTP from the DO and reaches the rest of the system through the gateway's HTTP API with a short-lived token supplied in `envVars` or per request.
