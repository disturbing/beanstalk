//! The crate's error type.

/// Everything that can go wrong serving a connection or starting the server.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    #[error("configuration: {0}")]
    Config(String),
    #[error("git protocol: {0}")]
    Protocol(String),
    #[error("gateway: {0}")]
    Gateway(String),
    #[error("limit reached: {0}")]
    Limit(String),
    #[error("i/o: {0}")]
    Io(#[from] std::io::Error),
    #[error("ssh: {0}")]
    Ssh(#[from] russh::Error),
}
