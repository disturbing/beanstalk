//! The SSH listener: one task per connection, at most `max_sessions` at once, each closed after
//! `max_session` whatever it is doing (russh closes idle ones after `idle_timeout`).

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use russh::keys::{HashAlg, PrivateKey};
use russh::{Disconnect, SshId, server};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Semaphore;

use super::handler::{Connection, Shared, public_key_only};
use crate::config::Limits;
use crate::gateway::Gateway;

const SERVER_ID: &str = "SSH-2.0-beanstalk";
const KEEPALIVE: Duration = Duration::from_secs(30);

/// The russh configuration for `limits`: public keys only, the host key, the timeouts.
pub fn russh_config(host_key: PrivateKey, limits: &Limits) -> server::Config {
    server::Config {
        server_id: SshId::Standard(SERVER_ID.into()),
        methods: public_key_only(),
        keys: vec![host_key],
        inactivity_timeout: Some(limits.idle_timeout),
        keepalive_interval: Some(KEEPALIVE),
        auth_rejection_time: Duration::from_millis(500),
        auth_rejection_time_initial: Some(Duration::ZERO),
        max_auth_attempts: limits.max_auth_attempts,
        nodelay: true,
        ..server::Config::default()
    }
}

/// `SHA256:…` of the host key, as `ssh` prints it and the web shows it.
pub fn host_key_fingerprint(host_key: &PrivateKey) -> String {
    host_key
        .public_key()
        .fingerprint(HashAlg::Sha256)
        .to_string()
}

/// The SSH server: its configuration, shared state and connection budget.
#[derive(Debug)]
pub struct SshServer<G> {
    config: Arc<server::Config>,
    shared: Arc<Shared<G>>,
    sessions: Arc<Semaphore>,
    max_session: Duration,
    next_id: AtomicU64,
}

impl<G: Gateway> SshServer<G> {
    pub fn new(config: server::Config, shared: Shared<G>, limits: &Limits) -> Self {
        Self {
            config: Arc::new(config),
            shared: Arc::new(shared),
            sessions: Arc::new(Semaphore::new(limits.max_sessions)),
            max_session: limits.max_session,
            next_id: AtomicU64::new(1),
        }
    }

    /// Accepts connections until the listener fails.
    ///
    /// # Errors
    ///
    /// The listener's accept error.
    pub async fn run(&self, listener: TcpListener) -> std::io::Result<()> {
        loop {
            let (stream, _peer) = listener.accept().await?;
            self.accept(stream);
        }
    }

    fn accept(&self, stream: TcpStream) {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let Ok(permit) = Arc::clone(&self.sessions).try_acquire_owned() else {
            tracing::warn!(
                connection = id,
                "connection refused: the session limit is reached"
            );
            return;
        };
        let config = Arc::clone(&self.config);
        let handler = Connection::new(Arc::clone(&self.shared), id);
        let max_session = self.max_session;
        tokio::spawn(async move {
            serve_connection(config, stream, handler, max_session, id).await;
            drop(permit);
        });
    }
}

async fn serve_connection<G: Gateway>(
    config: Arc<server::Config>,
    stream: TcpStream,
    handler: Connection<G>,
    max_session: Duration,
    id: u64,
) {
    let running = match server::run_stream(config, stream, handler).await {
        Ok(running) => running,
        Err(error) => {
            tracing::info!(connection = id, %error, "handshake failed");
            return;
        }
    };
    let handle = running.handle();
    match tokio::time::timeout(max_session, running).await {
        Ok(Ok(())) => tracing::debug!(connection = id, "connection closed"),
        Ok(Err(error)) => tracing::info!(connection = id, %error, "connection ended"),
        Err(_) => {
            tracing::info!(connection = id, "connection closed: session time limit");
            let reason = "the session time limit is reached".to_owned();
            // A failed disconnect means the connection is already gone.
            let _ = handle
                .disconnect(Disconnect::ByApplication, reason, "en".into())
                .await;
        }
    }
}
