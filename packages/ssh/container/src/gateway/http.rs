//! The gateway over plain HTTP. In the container the base URL is `http://gateway.internal`,
//! which the owning Durable Object intercepts and hands to the gateway Worker over its service
//! binding: the traffic never leaves Cloudflare and needs no credential of its own.

use std::time::Duration;

use futures_util::TryStreamExt;
use reqwest::{Client, Response, StatusCode};
use serde::{Deserialize, Serialize};
use tokio_util::io::StreamReader;

use super::{Gateway, GitCall, GitReply, KeyCheck, KeyOwner, PublicKeyLine, RequestBody};
use crate::error::Error;

/// The header that names the key a git request is made with (the gateway looks its owner up).
pub const KEY_HEADER: &str = "x-beanstalk-ssh-key";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// A push held with `-o wait` prints a keepalive every 15 s; a read gap this long is a stall.
const READ_TIMEOUT: Duration = Duration::from_mins(2);
const USER_AGENT: &str = concat!("gitstalk-ssh/", env!("CARGO_PKG_VERSION"));

/// The gateway reached at `base` (no trailing slash).
#[derive(Debug, Clone)]
pub struct HttpGateway {
    base: String,
    client: Client,
}

#[derive(Serialize)]
struct KeyLookup<'a> {
    public_key: &'a str,
    confirm: bool,
}

#[derive(Deserialize)]
struct KeyLookupReply {
    handle: String,
}

impl HttpGateway {
    /// # Errors
    ///
    /// [`Error::Config`] when the HTTP client cannot be built.
    pub fn new(base: &str) -> Result<Self, Error> {
        let client = Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(READ_TIMEOUT)
            .user_agent(USER_AGENT)
            .build()
            .map_err(|error| Error::Config(format!("http client: {error}")))?;
        Ok(Self {
            base: base.trim_end_matches('/').to_owned(),
            client,
        })
    }

    fn git_url(&self, call: &GitCall, rest: &str) -> String {
        format!("{}{}/{rest}", self.base, call.path.gateway_path())
    }

    fn git_request(
        &self,
        method: reqwest::Method,
        url: String,
        call: &GitCall,
    ) -> reqwest::RequestBuilder {
        let request = self
            .client
            .request(method, url)
            .header(KEY_HEADER, call.key.as_str());
        match &call.protocol {
            Some(protocol) => request.header("git-protocol", protocol),
            None => request,
        }
    }
}

impl Gateway for HttpGateway {
    async fn key_owner(
        &self,
        key: &PublicKeyLine,
        check: KeyCheck,
    ) -> Result<Option<KeyOwner>, Error> {
        let body = KeyLookup {
            public_key: key.as_str(),
            confirm: check == KeyCheck::Confirm,
        };
        let response = self
            .client
            .post(format!("{}/ssh/keys/lookup", self.base))
            .json(&body)
            .send()
            .await
            .map_err(gateway_error)?;
        match response.status() {
            StatusCode::OK => {
                let reply: KeyLookupReply = response.json().await.map_err(gateway_error)?;
                Ok(Some(KeyOwner {
                    handle: reply.handle,
                }))
            }
            StatusCode::NOT_FOUND => Ok(None),
            status => Err(Error::Gateway(format!("key lookup answered {status}"))),
        }
    }

    async fn advertise(&self, call: &GitCall) -> Result<GitReply, Error> {
        let url = self.git_url(
            call,
            &format!("info/refs?service={}", call.service.as_str()),
        );
        let response = self
            .git_request(reqwest::Method::GET, url, call)
            .send()
            .await
            .map_err(gateway_error)?;
        Ok(reply(response))
    }

    async fn service(&self, call: &GitCall, body: RequestBody) -> Result<GitReply, Error> {
        let service = call.service.as_str();
        let stream = futures_util::stream::unfold(body, |mut body| async move {
            body.recv().await.map(|chunk| (chunk, body))
        });
        let response = self
            .git_request(reqwest::Method::POST, self.git_url(call, service), call)
            .header("content-type", format!("application/x-{service}-request"))
            .header("accept", format!("application/x-{service}-result"))
            .body(reqwest::Body::wrap_stream(stream))
            .send()
            .await
            .map_err(gateway_error)?;
        Ok(reply(response))
    }
}

fn reply(response: Response) -> GitReply {
    let status = response.status().as_u16();
    let stream = response.bytes_stream().map_err(std::io::Error::other);
    GitReply {
        status,
        body: Box::pin(StreamReader::new(stream)),
    }
}

fn gateway_error(error: reqwest::Error) -> Error {
    // reqwest's message never includes headers, so the key header cannot leak here.
    Error::Gateway(error.without_url().to_string())
}
