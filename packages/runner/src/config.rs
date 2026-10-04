//! Configuration, read once from the environment at startup.

use std::fmt;
use std::path::{Path, PathBuf};

use crate::error::Error;

const DEFAULT_PORT: u16 = 8080;
const DEFAULT_WORK_DIR: &str = "/work";
const DEFAULT_REMOTE_SCHEMES: &str = "https";
const DEFAULT_COMMIT_NAME: &str = "beanstalk-runner";
const DEFAULT_COMMIT_EMAIL: &str = "runner@beanstalk.invalid";

/// Runtime configuration of the runner.
///
/// | Variable | Default | Meaning |
/// |---|---|---|
/// | `PORT` | 8080 | listen port (bound on `0.0.0.0`) |
/// | `WORK_DIR` | `/work` | bare-repo caches and per-request scratch directories |
/// | `REMOTE_SCHEMES` | `https` | comma-separated URL schemes a request may name (`https`, `file`) |
/// | `COMMIT_AUTHOR_NAME`, `COMMIT_AUTHOR_EMAIL` | `beanstalk-runner`, `runner@beanstalk.invalid` | identity on squash and revert commits |
/// | `CLOUDFLARE_DEPLOYMENT_ID` | unset | logged at startup |
#[derive(Debug, Clone)]
pub struct Config {
    port: u16,
    work_dir: PathBuf,
    remote_schemes: RemoteSchemes,
    identity: CommitIdentity,
    deployment_id: Option<String>,
}

impl Config {
    /// Reads the configuration from the process environment.
    ///
    /// # Errors
    ///
    /// [`Error::Config`] naming every variable that is set but invalid.
    pub fn from_env() -> Result<Self, Error> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    /// Reads the configuration through `lookup`, which returns a variable's value when it is set.
    ///
    /// # Errors
    ///
    /// [`Error::Config`] naming every variable that is set but invalid.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, Error> {
        let port = parse_port(lookup("PORT"));
        let work_dir = parse_work_dir(lookup("WORK_DIR"));
        let remote_schemes = RemoteSchemes::parse(
            lookup("REMOTE_SCHEMES")
                .as_deref()
                .unwrap_or(DEFAULT_REMOTE_SCHEMES),
        );
        let identity =
            CommitIdentity::parse(lookup("COMMIT_AUTHOR_NAME"), lookup("COMMIT_AUTHOR_EMAIL"));
        match (port, work_dir, remote_schemes, identity) {
            (Ok(port), Ok(work_dir), Ok(remote_schemes), Ok(identity)) => Ok(Self {
                port,
                work_dir,
                remote_schemes,
                identity,
                deployment_id: lookup("CLOUDFLARE_DEPLOYMENT_ID"),
            }),
            (port, work_dir, schemes, identity) => {
                let problems: Vec<String> =
                    [port.err(), work_dir.err(), schemes.err(), identity.err()]
                        .into_iter()
                        .flatten()
                        .collect();
                Err(Error::Config(problems.join("; ")))
            }
        }
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn work_dir(&self) -> &Path {
        &self.work_dir
    }

    pub fn remote_schemes(&self) -> &RemoteSchemes {
        &self.remote_schemes
    }

    pub fn identity(&self) -> &CommitIdentity {
        &self.identity
    }

    pub fn deployment_id(&self) -> Option<&str> {
        self.deployment_id.as_deref()
    }
}

fn parse_port(raw: Option<String>) -> Result<u16, String> {
    match raw {
        None => Ok(DEFAULT_PORT),
        Some(text) => text
            .trim()
            .parse::<u16>()
            .map_err(|_| format!("PORT must be a port number, got {text:?}")),
    }
}

fn parse_work_dir(raw: Option<String>) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw.unwrap_or_else(|| DEFAULT_WORK_DIR.to_owned()));
    if path.is_absolute() {
        Ok(path)
    } else {
        Err(format!(
            "WORK_DIR must be an absolute path, got {}",
            path.display()
        ))
    }
}

/// A URL scheme a request's `repo` may use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RemoteScheme {
    /// Cloudflare Artifacts and other smart-HTTP remotes.
    Https,
    /// Local bare repositories: tests and local development only.
    File,
}

impl RemoteScheme {
    fn parse(name: &str) -> Option<Self> {
        match name {
            "https" => Some(Self::Https),
            "file" => Some(Self::File),
            _ => None,
        }
    }

    /// The scheme as written in a URL, without `://`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Https => "https",
            Self::File => "file",
        }
    }
}

/// The URL schemes a request may name; plain `http` is never allowed (tokens would travel in clear).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteSchemes(Vec<RemoteScheme>);

impl RemoteSchemes {
    fn parse(list: &str) -> Result<Self, String> {
        let names: Vec<&str> = list
            .split(',')
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .collect();
        let schemes: Vec<RemoteScheme> = names
            .iter()
            .filter_map(|name| RemoteScheme::parse(name))
            .collect();
        if schemes.is_empty() || schemes.len() != names.len() {
            return Err(format!(
                "REMOTE_SCHEMES must list https and/or file, got {list:?}"
            ));
        }
        Ok(Self(schemes))
    }

    /// Whether a URL with this scheme name may be used.
    pub fn allows(&self, scheme: &str) -> bool {
        self.0.iter().any(|allowed| allowed.as_str() == scheme)
    }
}

impl fmt::Display for RemoteSchemes {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let names: Vec<&str> = self.0.iter().map(|scheme| scheme.as_str()).collect();
        f.write_str(&names.join(","))
    }
}

/// Author and committer of the commits the runner creates.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitIdentity {
    name: String,
    email: String,
}

impl CommitIdentity {
    fn parse(name: Option<String>, email: Option<String>) -> Result<Self, String> {
        let name = name.unwrap_or_else(|| DEFAULT_COMMIT_NAME.to_owned());
        let email = email.unwrap_or_else(|| DEFAULT_COMMIT_EMAIL.to_owned());
        let is_valid =
            |value: &str| !value.trim().is_empty() && !value.contains(['<', '>', '\n', '\r', '\0']);
        if is_valid(&name) && is_valid(&email) {
            Ok(Self { name, email })
        } else {
            Err("COMMIT_AUTHOR_NAME and COMMIT_AUTHOR_EMAIL must be non-empty without <, > or newlines".to_owned())
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn email(&self) -> &str {
        &self.email
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

    use std::collections::HashMap;

    use super::*;

    fn config_from(vars: &[(&str, &str)]) -> Result<Config, Error> {
        let vars: HashMap<String, String> = vars
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect();
        Config::from_lookup(|name| vars.get(name).cloned())
    }

    #[test]
    fn defaults_match_the_container_contract() {
        let config = config_from(&[]).unwrap();

        assert_eq!(config.port(), 8080);
        assert_eq!(config.work_dir(), Path::new("/work"));
        assert!(config.remote_schemes().allows("https"));
        assert!(!config.remote_schemes().allows("file"));
        assert_eq!(config.identity().name(), "beanstalk-runner");
    }

    #[test]
    fn reads_every_variable() {
        let config = config_from(&[
            ("PORT", "9090"),
            ("WORK_DIR", "/tmp/work"),
            ("REMOTE_SCHEMES", "https, file"),
            ("COMMIT_AUTHOR_NAME", "race-harness"),
            ("COMMIT_AUTHOR_EMAIL", "race@beanstalk.invalid"),
            ("CLOUDFLARE_DEPLOYMENT_ID", "dep-1"),
        ])
        .unwrap();

        assert_eq!(config.port(), 9090);
        assert_eq!(config.work_dir(), Path::new("/tmp/work"));
        assert!(config.remote_schemes().allows("file"));
        assert_eq!(config.identity().email(), "race@beanstalk.invalid");
        assert_eq!(config.deployment_id(), Some("dep-1"));
    }

    #[test]
    fn reports_every_invalid_variable_at_once() {
        let error = config_from(&[
            ("PORT", "eighty"),
            ("WORK_DIR", "relative/dir"),
            ("REMOTE_SCHEMES", "http"),
        ])
        .unwrap_err()
        .to_string();

        assert!(error.contains("PORT"), "{error}");
        assert!(error.contains("WORK_DIR"), "{error}");
        assert!(error.contains("REMOTE_SCHEMES"), "{error}");
    }

    #[test]
    fn rejects_an_identity_that_would_corrupt_a_commit_header() {
        let error = config_from(&[("COMMIT_AUTHOR_EMAIL", "a@b>\nx")]).unwrap_err();

        assert!(error.to_string().contains("COMMIT_AUTHOR"));
    }
}
