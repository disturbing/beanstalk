//! Configuration, read once from the environment at startup.

use std::fmt;
use std::time::Duration;

use russh::keys::PrivateKey;

use crate::error::Error;

/// Runtime configuration of the SSH server.
///
/// | Variable | Default | Meaning |
/// |---|---|---|
/// | `SSH_PORT` | 2222 | SSH listen port (bound on `0.0.0.0`; the Durable Object forwards TCP to it) |
/// | `PORT` | 8080 | health port (`GET /healthz`), which the Container class waits for |
/// | `SSH_HOST_KEY` | required | the host's OpenSSH private key (a Worker secret; `\n` escapes accepted) |
/// | `GATEWAY_URL` | `http://gateway.internal` | the gateway, as the container reaches it |
/// | `MAX_SESSIONS` | 64 | concurrent SSH connections; more are closed at once |
/// | `IDLE_TIMEOUT_SECONDS` | 300 | a connection with no traffic this long is closed |
/// | `MAX_SESSION_SECONDS` | 3600 | a connection's whole life (a `-o wait` push lasts up to 1800 s) |
/// | `MAX_PUSH_BYTES` | 536870912 | one push's commands and pack |
/// | `MAX_AUTH_ATTEMPTS` | 6 | public keys a connection may try |
#[derive(Clone)]
pub struct Config {
    pub ssh_port: u16,
    pub health_port: u16,
    pub host_key: PrivateKey,
    pub gateway_url: String,
    pub limits: Limits,
    pub deployment_id: Option<String>,
}

/// Per-connection and per-server bounds.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub max_sessions: usize,
    pub idle_timeout: Duration,
    pub max_session: Duration,
    pub max_push_bytes: u64,
    pub max_auth_attempts: usize,
}

impl fmt::Debug for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Config")
            .field("ssh_port", &self.ssh_port)
            .field("health_port", &self.health_port)
            .field("host_key", &"<secret>")
            .field("gateway_url", &self.gateway_url)
            .field("limits", &self.limits)
            .finish_non_exhaustive()
    }
}

impl Config {
    /// Reads the configuration from the process environment.
    ///
    /// # Errors
    ///
    /// [`Error::Config`] naming every variable that is missing or invalid.
    pub fn from_env() -> Result<Self, Error> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    /// Reads the configuration through `lookup`, which returns a variable's value when set.
    ///
    /// # Errors
    ///
    /// [`Error::Config`] naming every variable that is missing or invalid.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, Error> {
        let mut problems = Vec::new();
        let mut number = |name: &str, default: u64| -> u64 {
            match lookup(name).map(|value| value.trim().parse::<u64>()) {
                None => default,
                Some(Ok(value)) if value > 0 => value,
                Some(_) => {
                    problems.push(format!("{name} must be a positive integer"));
                    default
                }
            }
        };
        let ssh_port = number("SSH_PORT", 2222);
        let health_port = number("PORT", 8080);
        let max_sessions = number("MAX_SESSIONS", 64);
        let idle_seconds = number("IDLE_TIMEOUT_SECONDS", 300);
        let session_seconds = number("MAX_SESSION_SECONDS", 3600);
        let max_push_bytes = number("MAX_PUSH_BYTES", 512 * 1024 * 1024);
        let max_auth_attempts = number("MAX_AUTH_ATTEMPTS", 6);
        let ports = (u16::try_from(ssh_port), u16::try_from(health_port));
        let host_key = parse_host_key(lookup("SSH_HOST_KEY"));
        let (Ok(ssh_port), Ok(health_port)) = ports else {
            problems.push("SSH_PORT and PORT must be ports".into());
            return Err(Error::Config(problems.join("; ")));
        };
        let host_key = match host_key {
            Ok(key) if problems.is_empty() => key,
            Ok(_) => return Err(Error::Config(problems.join("; "))),
            Err(problem) => {
                problems.push(problem);
                return Err(Error::Config(problems.join("; ")));
            }
        };
        Ok(Self {
            ssh_port,
            health_port,
            host_key,
            gateway_url: lookup("GATEWAY_URL").unwrap_or_else(|| "http://gateway.internal".into()),
            limits: Limits {
                max_sessions: usize::try_from(max_sessions).unwrap_or(usize::MAX),
                idle_timeout: Duration::from_secs(idle_seconds),
                max_session: Duration::from_secs(session_seconds),
                max_push_bytes,
                max_auth_attempts: usize::try_from(max_auth_attempts).unwrap_or(usize::MAX),
            },
            deployment_id: lookup("CLOUDFLARE_DEPLOYMENT_ID"),
        })
    }
}

/// The host key from its OpenSSH text. The error never quotes the value.
fn parse_host_key(value: Option<String>) -> Result<PrivateKey, String> {
    let text = value.ok_or("SSH_HOST_KEY is required (the host's OpenSSH private key)")?;
    let text = text.replace("\\n", "\n");
    PrivateKey::from_openssh(format!("{}\n", text.trim()))
        .map_err(|_| "SSH_HOST_KEY is not an unencrypted OpenSSH private key".to_owned())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

    use super::*;

    use russh::keys::{Algorithm, ssh_key::LineEnding};

    fn host_key_text() -> String {
        let key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
        key.to_openssh(LineEnding::LF).unwrap().to_string()
    }

    #[test]
    fn reads_defaults_with_a_host_key() {
        let key = host_key_text();
        let config =
            Config::from_lookup(|name| (name == "SSH_HOST_KEY").then(|| key.clone())).unwrap();
        assert_eq!(config.ssh_port, 2222);
        assert_eq!(config.health_port, 8080);
        assert_eq!(config.gateway_url, "http://gateway.internal");
        assert_eq!(config.limits.max_sessions, 64);
    }

    #[test]
    fn accepts_a_host_key_with_escaped_newlines() {
        let key = host_key_text().replace('\n', "\\n");
        let config = Config::from_lookup(|name| (name == "SSH_HOST_KEY").then(|| key.clone()));
        assert!(config.is_ok());
    }

    #[test]
    fn names_every_problem_and_never_the_key() {
        let error = Config::from_lookup(|name| match name {
            "SSH_HOST_KEY" => Some("not-a-key-SECRETVALUE".into()),
            "MAX_SESSIONS" => Some("lots".into()),
            _ => None,
        })
        .unwrap_err()
        .to_string();
        assert!(error.contains("MAX_SESSIONS"), "{error}");
        assert!(error.contains("SSH_HOST_KEY"), "{error}");
        assert!(!error.contains("SECRETVALUE"), "{error}");
    }

    #[test]
    fn debug_hides_the_host_key() {
        let key = host_key_text();
        let config =
            Config::from_lookup(|name| (name == "SSH_HOST_KEY").then(|| key.clone())).unwrap();
        assert!(!format!("{config:?}").contains("PRIVATE KEY"));
    }
}
