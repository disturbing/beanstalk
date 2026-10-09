//! The tool's HTTP client for `http://deps.internal`, the container's outbound handler into the
//! executor Worker. Every request carries the job's bearer; the Worker resolves it to the
//! repository and scope.

use std::time::Duration;

use bytes::Bytes;
use futures_util::StreamExt;
use reqwest::{Client, Method, RequestBuilder, Response, StatusCode};
use serde::Serialize;
use serde::de::DeserializeOwned;
use sha2::{Digest, Sha256};

use super::key::hex;
use super::manifest::{
    CommitResponse, CompleteUpload, LookupRequest, LookupResponse, Manifest, MissingRequest,
    MissingResponse, UploadStarted, UploadedPart,
};
use crate::error::{Error, Result};

const CALL_TIMEOUT: Duration = Duration::from_mins(1);
const CHUNK_TIMEOUT: Duration = Duration::from_mins(5);

/// The cache service for one job.
#[derive(Debug, Clone)]
pub struct DepsClient {
    http: Client,
    base: String,
    token: String,
}

impl DepsClient {
    /// # Errors
    ///
    /// [`Error::Config`] when the HTTP client cannot be built.
    pub fn new(base: &str, token: &str) -> Result<Self> {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .pool_max_idle_per_host(16)
            .build()
            .map_err(|error| Error::Config(format!("http client: {error}")))?;
        Ok(Self {
            http,
            base: base.trim_end_matches('/').to_owned(),
            token: token.to_owned(),
        })
    }

    /// # Errors
    ///
    /// [`Error::Uplink`] when the Worker cannot be reached or refuses.
    pub async fn lookup(&self, request: &LookupRequest) -> Result<LookupResponse> {
        self.call(Method::POST, "/v1/lookup", request).await
    }

    /// # Errors
    ///
    /// [`Error::Uplink`] when the Worker cannot be reached or refuses.
    pub async fn missing(&self, chunks: Vec<String>) -> Result<Vec<String>> {
        let answer: MissingResponse = self
            .call(Method::POST, "/v1/missing", &MissingRequest { chunks })
            .await?;
        Ok(answer.missing)
    }

    /// # Errors
    ///
    /// [`Error::Uplink`] when the Worker cannot be reached or refuses.
    pub async fn commit(&self, manifest: &Manifest) -> Result<CommitResponse> {
        self.call(Method::POST, "/v1/commit", manifest).await
    }

    /// Streams one chunk into `extractor`, hashing it on the way; an error when its sha256 or
    /// size is not the manifest's. Not retried: bytes already went into the extraction, so the
    /// caller empties the tmpfs and the job installs normally.
    ///
    /// # Errors
    ///
    /// [`Error::Uplink`] when the chunk cannot be read, [`Error::Integrity`] on a mismatch,
    /// [`Error::Io`] when the extraction fails.
    pub async fn chunk_into(
        &self,
        sha256: &str,
        bytes: u64,
        extractor: &mut super::archive::Extractor,
    ) -> Result<()> {
        let response = self
            .request(Method::GET, &format!("/v1/chunks/{sha256}"))
            .timeout(CHUNK_TIMEOUT)
            .send()
            .await
            .map_err(|error| Error::Uplink(format!("chunk {sha256}: {error}")))?;
        let response = checked(response, "chunk").await?;
        let mut hasher = Sha256::new();
        let mut received: u64 = 0;
        let mut stream = response.bytes_stream();
        while let Some(piece) = stream.next().await {
            let piece = piece.map_err(|error| Error::Uplink(format!("chunk {sha256}: {error}")))?;
            hasher.update(&piece);
            received += u64::try_from(piece.len()).unwrap_or(u64::MAX);
            extractor.feed(&piece).await?;
        }
        let got = hex(&hasher.finalize());
        if got != sha256 || received != bytes {
            return Err(Error::Integrity(format!(
                "chunk {sha256} arrived as {got} ({received} bytes, expected {bytes})"
            )));
        }
        Ok(())
    }

    /// Uploads one chunk: a single request up to `single_max`, else R2 multipart parts.
    ///
    /// # Errors
    ///
    /// [`Error::Uplink`] when the Worker refuses or cannot be reached.
    pub async fn upload(&self, sha256: &str, body: Bytes, part_size: usize) -> Result<()> {
        if body.len() <= part_size {
            let response = self
                .request(Method::PUT, &format!("/v1/chunks/{sha256}"))
                .timeout(CHUNK_TIMEOUT)
                .header("content-length", body.len())
                .body(body)
                .send()
                .await
                .map_err(|error| Error::Uplink(format!("upload {sha256}: {error}")))?;
            checked(response, "upload").await?;
            return Ok(());
        }
        let started: UploadStarted = self
            .call(Method::POST, &format!("/v1/uploads/{sha256}"), &())
            .await?;
        let mut parts = Vec::new();
        for (index, part) in body.chunks(part_size).enumerate() {
            let number =
                u32::try_from(index + 1).map_err(|_| Error::Uplink("too many parts".into()))?;
            let path = format!(
                "/v1/uploads/{sha256}/{number}?uploadId={}",
                percent_encoding::utf8_percent_encode(
                    &started.upload_id,
                    percent_encoding::NON_ALPHANUMERIC
                )
            );
            let response = self
                .request(Method::PUT, &path)
                .timeout(CHUNK_TIMEOUT)
                .header("content-length", part.len())
                .body(body.slice_ref(part))
                .send()
                .await
                .map_err(|error| {
                    Error::Uplink(format!("upload {sha256} part {number}: {error}"))
                })?;
            let uploaded: UploadedPart = parse(checked(response, "upload part").await?).await?;
            parts.push(uploaded);
        }
        let complete = CompleteUpload {
            upload_id: started.upload_id,
            parts,
        };
        let _: serde_json::Value = self
            .call(
                Method::POST,
                &format!("/v1/uploads/{sha256}/complete"),
                &complete,
            )
            .await?;
        Ok(())
    }

    async fn call<B: Serialize + ?Sized, T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: &B,
    ) -> Result<T> {
        let response = self
            .request(method, path)
            .timeout(CALL_TIMEOUT)
            .json(body)
            .send()
            .await
            .map_err(|error| Error::Uplink(format!("{path}: {error}")))?;
        parse(checked(response, path).await?).await
    }

    fn request(&self, method: Method, path: &str) -> RequestBuilder {
        self.http
            .request(method, format!("{}{path}", self.base))
            .bearer_auth(&self.token)
    }
}

async fn checked(response: Response, what: &str) -> Result<Response> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let text = response.text().await.unwrap_or_default();
    let detail: String = text.chars().take(300).collect();
    if status == StatusCode::FORBIDDEN {
        return Err(Error::Uplink(format!("{what}: refused: {detail}")));
    }
    Err(Error::Uplink(format!("{what}: {status}: {detail}")))
}

async fn parse<T: DeserializeOwned>(response: Response) -> Result<T> {
    response
        .json()
        .await
        .map_err(|error| Error::Uplink(format!("unexpected answer: {error}")))
}
