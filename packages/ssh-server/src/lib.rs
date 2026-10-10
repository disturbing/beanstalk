//! Git over SSH for Gitstalk.
//!
//! A person runs `git clone ssh://git@<host>/<owner>/<repo>.git` or `git push`; the connection
//! reaches this server through Spectrum, the `beanstalk-ssh` Worker's `connect` handler and its
//! Durable Object. The server authenticates the client's public key against the keys people
//! registered, then bridges `git-upload-pack` and `git-receive-pack` to the gateway's smart-HTTP
//! proxy as that person, so access rules, push = submit, `remote:` verdicts and refusals are the
//! gateway's, exactly as over HTTPS (`docs/claude-opus/21-git-over-ssh.md`).

pub mod config;
pub mod error;
pub mod gateway;
pub mod git;
pub mod health;
pub mod ssh;
pub mod telemetry;
