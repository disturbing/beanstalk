//! Posting to the executor. In a Cloudflare Container `EXECUTOR_URL` is
//! `http://executor.internal`, a host the container's outbound handler intercepts and turns
//! into an RPC call on the job's own Durable Object; nothing leaves Cloudflare's network.

use std::future::Future;
use std::time::Duration;

use reqwest::Client;
use serde::Serialize;

use crate::error::{Error, Result};
use crate::wire::{Batch, LogLine, RunnerResult};

const POST_TIMEOUT: Duration = Duration::from_secs(30);
/// Attempts for a batch or the result: about two minutes in all before giving up.
const ATTEMPTS: u32 = 8;
const FIRST_RETRY_WAIT: Duration = Duration::from_millis(500);
const MAX_RETRY_WAIT: Duration = Duration::from_secs(30);

/// Where the job's lines and result go. Both are retried until acknowledged.
pub trait Uplink: Send + Sync {
    fn batch(
        &self,
        job_id: &str,
        index: u32,
        lines: &[LogLine],
    ) -> impl Future<Output = Result<()>> + Send;
    fn result(&self, result: &RunnerResult) -> impl Future<Output = Result<()>> + Send;
}

/// The uplink over HTTP to `EXECUTOR_URL`.
#[derive(Debug, Clone)]
pub struct HttpUplink {
    client: Client,
    base: String,
}

impl HttpUplink {
    /// # Errors
    ///
    /// [`Error::Config`] when the HTTP client cannot be built.
    pub fn new(base: &str) -> Result<Self> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|error| Error::Config(format!("http client: {error}")))?;
        Ok(Self {
            client,
            base: base.to_owned(),
        })
    }

    async fn post_once<T: Serialize + Sync>(&self, path: &str, body: &T) -> Result<()> {
        let response = self
            .client
            .post(format!("{}{path}", self.base))
            .timeout(POST_TIMEOUT)
            .json(body)
            .send()
            .await
            .map_err(|error| Error::Uplink(format!("{path}: {error}")))?;
        if response.status().is_success() {
            return Ok(());
        }
        Err(Error::Uplink(format!(
            "{path} answered {}",
            response.status()
        )))
    }

    async fn post<T: Serialize + Sync>(&self, path: &str, body: &T) -> Result<()> {
        let mut wait = FIRST_RETRY_WAIT;
        let mut attempt = 1;
        loop {
            match self.post_once(path, body).await {
                Ok(()) => return Ok(()),
                Err(error) if attempt >= ATTEMPTS => return Err(error),
                Err(error) => {
                    tracing::warn!(%error, attempt, "post to the executor failed, retrying");
                    tokio::time::sleep(wait).await;
                    wait = (wait * 2).min(MAX_RETRY_WAIT);
                    attempt += 1;
                }
            }
        }
    }
}

impl Uplink for HttpUplink {
    async fn batch(&self, job_id: &str, index: u32, lines: &[LogLine]) -> Result<()> {
        self.post(
            "/v1/batches",
            &Batch {
                job_id,
                index,
                lines,
            },
        )
        .await
    }

    async fn result(&self, result: &RunnerResult) -> Result<()> {
        self.post("/v1/result", result).await
    }
}
