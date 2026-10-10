//! The gateway as the SSH server sees it: who owns a key, and the smart-HTTP git proxy, called
//! as the key's owner. The container never decides access and never holds a repository token:
//! the gateway applies the same rules (`mayUseEngine`) and the same push flow as for HTTPS.

mod http;

use std::future::Future;
use std::pin::Pin;

use bytes::Bytes;
use tokio::io::AsyncRead;
use tokio::sync::mpsc;

pub use self::http::HttpGateway;
use crate::error::Error;
use crate::git::command::{RepoPath, Service};

/// A client's public key in OpenSSH form (`ssh-ed25519 AAAA…`), without a comment.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PublicKeyLine(String);

impl PublicKeyLine {
    pub fn new(line: impl Into<String>) -> Self {
        Self(line.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// The person a key belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyOwner {
    pub handle: String,
}

/// Whether the key's use is being probed (offered, unsigned) or confirmed (signature checked);
/// only a confirmed use counts as the key being used.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyCheck {
    Probe,
    Confirm,
}

/// One smart-HTTP request to the gateway, made as the key's owner.
#[derive(Debug, Clone)]
pub struct GitCall {
    pub key: PublicKeyLine,
    pub path: RepoPath,
    pub service: Service,
    /// The client's `GIT_PROTOCOL` (`version=2`), forwarded as the `Git-Protocol` header.
    pub protocol: Option<String>,
}

/// The gateway's answer: an HTTP status and the body as a stream.
pub struct GitReply {
    pub status: u16,
    pub body: Pin<Box<dyn AsyncRead + Send>>,
}

impl std::fmt::Debug for GitReply {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GitReply")
            .field("status", &self.status)
            .finish_non_exhaustive()
    }
}

/// A request body, streamed as it arrives from the SSH channel.
pub type RequestBody = mpsc::Receiver<Result<Bytes, std::io::Error>>;

/// What the SSH server needs from the gateway.
pub trait Gateway: Clone + Send + Sync + 'static {
    /// The key's owner, or `None` when no account has registered the key.
    fn key_owner(
        &self,
        key: &PublicKeyLine,
        check: KeyCheck,
    ) -> impl Future<Output = Result<Option<KeyOwner>, Error>> + Send;

    /// `GET info/refs?service=…`: the ref (or v2 capability) advertisement.
    fn advertise(&self, call: &GitCall) -> impl Future<Output = Result<GitReply, Error>> + Send;

    /// `POST git-upload-pack` or `git-receive-pack` with `body`.
    fn service(
        &self,
        call: &GitCall,
        body: RequestBody,
    ) -> impl Future<Output = Result<GitReply, Error>> + Send;
}
