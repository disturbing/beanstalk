//! Configuration, read once from the environment at startup.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::error::Error;

const DEFAULT_PORT: u16 = 8080;
const DEFAULT_WORK_ROOT: &str = "/home/runner/work";
const DEFAULT_ACT_BIN: &str = "/usr/local/bin/act";
const DEFAULT_EXECUTOR_URL: &str = "http://executor.internal";
const DEFAULT_CANCEL_GRACE_SECONDS: u64 = 10;

/// Runtime configuration of the job runner.
///
/// | Variable | Default | Meaning |
/// |---|---|---|
/// | `PORT` | 8080 | listen port (bound on `0.0.0.0`) |
/// | `WORK_ROOT` | `/home/runner/work` | the job's scratch directory (workflow, event, env files) |
/// | `ACT_BIN` | `/usr/local/bin/act` | the `act` binary |
/// | `EXECUTOR_URL` | `http://executor.internal` | where log batches, chunks and the result go (the container's outbound handler) |
/// | `CANCEL_GRACE_SECONDS` | 10 | SIGTERM to SIGKILL on cancel and timeout |
/// | `ACT_VERSION`, `IMAGE_VERSION` | `unknown` | reported by `/version` and in the result |
#[derive(Debug, Clone)]
pub struct Config {
    port: u16,
    work_root: PathBuf,
    act_bin: PathBuf,
    executor_url: String,
    cancel_grace: Duration,
    act_version: String,
    image_version: String,
}

impl Config {
    /// Reads the configuration from the process environment.
    ///
    /// # Errors
    ///
    /// [`Error::Config`] naming the variable that is set but invalid.
    pub fn from_env() -> Result<Self, Error> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    /// Reads the configuration through `lookup`, which returns a variable's value when it is set.
    ///
    /// # Errors
    ///
    /// [`Error::Config`] naming the variable that is set but invalid.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, Error> {
        let port = match lookup("PORT") {
            Some(value) => value
                .parse()
                .map_err(|_| Error::Config(format!("PORT is not a port: {value}")))?,
            None => DEFAULT_PORT,
        };
        let grace = match lookup("CANCEL_GRACE_SECONDS") {
            Some(value) => value.parse().map_err(|_| {
                Error::Config(format!("CANCEL_GRACE_SECONDS is not seconds: {value}"))
            })?,
            None => DEFAULT_CANCEL_GRACE_SECONDS,
        };
        let executor_url = lookup("EXECUTOR_URL").unwrap_or_else(|| DEFAULT_EXECUTOR_URL.into());
        if !executor_url.starts_with("http://") && !executor_url.starts_with("https://") {
            return Err(Error::Config(format!(
                "EXECUTOR_URL must be an http(s) URL: {executor_url}"
            )));
        }
        Ok(Self {
            port,
            work_root: lookup("WORK_ROOT").map_or_else(|| DEFAULT_WORK_ROOT.into(), PathBuf::from),
            act_bin: lookup("ACT_BIN").map_or_else(|| DEFAULT_ACT_BIN.into(), PathBuf::from),
            executor_url: executor_url.trim_end_matches('/').to_owned(),
            cancel_grace: Duration::from_secs(grace),
            act_version: lookup("ACT_VERSION").unwrap_or_else(|| "unknown".into()),
            image_version: lookup("IMAGE_VERSION").unwrap_or_else(|| "unknown".into()),
        })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn work_root(&self) -> &Path {
        &self.work_root
    }

    pub fn act_bin(&self) -> &Path {
        &self.act_bin
    }

    pub fn executor_url(&self) -> &str {
        &self.executor_url
    }

    pub fn cancel_grace(&self) -> Duration {
        self.cancel_grace
    }

    pub fn act_version(&self) -> &str {
        &self.act_version
    }

    pub fn image_version(&self) -> &str {
        &self.image_version
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_point_at_the_outbound_handler() -> Result<(), Error> {
        let config = Config::from_lookup(|_| None)?;
        assert_eq!(config.port(), 8080);
        assert_eq!(config.executor_url(), "http://executor.internal");
        assert_eq!(config.cancel_grace(), Duration::from_secs(10));
        Ok(())
    }

    #[test]
    fn refuses_an_executor_url_that_is_not_http() {
        let result =
            Config::from_lookup(|name| (name == "EXECUTOR_URL").then(|| "file:///x".into()));
        assert!(matches!(result, Err(Error::Config(_))));
    }

    #[test]
    fn trims_a_trailing_slash_from_the_executor_url() -> Result<(), Error> {
        let config = Config::from_lookup(|name| {
            (name == "EXECUTOR_URL").then(|| "http://127.0.0.1:9/".into())
        })?;
        assert_eq!(config.executor_url(), "http://127.0.0.1:9");
        Ok(())
    }
}
