//! The Docker daemon inside the job's container, for jobs act cannot run on the host:
//! `services:` (host mode skips them silently, a false green), `container:` and Docker
//! actions. Measured in the spike (docs/claude-opus/exp/actions-spike/README.md §2): root
//! `dockerd` with default flags starts in about 2 s on Cloudflare Containers' default policy,
//! with working bridge networking, published ports and `docker build`. The daemon lives as long
//! as the container, which is destroyed after the job.

use std::process::Stdio;
use std::time::Duration;

use tokio::process::{Child, Command};

use crate::config::DockerConfig;
use crate::error::{Error, Result};

const READY_TIMEOUT: Duration = Duration::from_mins(1);
const READY_POLL: Duration = Duration::from_millis(500);

/// The running daemon; dropping it kills the daemon.
#[derive(Debug)]
pub struct Daemon {
    _child: Child,
}

/// Starts the daemon and waits until its client answers.
///
/// # Errors
///
/// [`Error::Io`] when the daemon cannot be started, [`Error::Timeout`] when it never answers.
pub async fn start(config: &DockerConfig) -> Result<Daemon> {
    let (program, args) = config
        .daemon
        .split_first()
        .ok_or_else(|| Error::Config("DOCKERD is empty".into()))?;
    let child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(Error::io("starting dockerd"))?;
    let deadline = tokio::time::Instant::now() + READY_TIMEOUT;
    while tokio::time::Instant::now() < deadline {
        if is_ready(config).await {
            return Ok(Daemon { _child: child });
        }
        tokio::time::sleep(READY_POLL).await;
    }
    Err(Error::Timeout {
        op: "starting Docker",
        seconds: READY_TIMEOUT.as_secs(),
    })
}

async fn is_ready(config: &DockerConfig) -> bool {
    Command::new(&config.client)
        .args(["version", "--format", "{{.Server.Version}}"])
        .env("DOCKER_HOST", format!("unix://{}", config.socket))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .is_ok_and(|status| status.success())
}
