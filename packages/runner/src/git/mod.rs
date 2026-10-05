//! Git, one process per command, over bare caches under `WORK_DIR`.
//!
//! Every command runs with an isolated environment (no system or global config, no prompts,
//! `LC_ALL=C`, the runner's commit identity). Configuration a command needs, including the
//! `Authorization` header for a remote, travels in `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/
//! `GIT_CONFIG_VALUE_n`: the environment form of `git -c`, which keeps tokens out of argv (visible
//! to every process through `ps`) and off disk.

mod cache;
mod ids;
mod remote;
mod repo;
mod rules;

use std::ffi::{OsStr, OsString};
use std::path::Path;
use std::time::Duration;

pub(crate) use cache::{Lease, RefUpdate, RefUpdateOutcome, RepoCaches, TrunkCache};
pub(crate) use ids::{CommitSha, RefName, TreeId};
pub(crate) use remote::{Remote, RemoteUrl, Token};
pub(crate) use repo::{Repo, ThreeWay, TreeMerge};
pub(crate) use rules::{AttrPattern, MergeDriver, MergeRules, MergeSetup, StructuralTier};

use crate::config::CommitIdentity;
use crate::error::{Error, Result};
use crate::process::{self, ChildEnv, ProcessSpec};

/// Local commands (merge-tree, commit-tree, diff) on a small repo take milliseconds; the harness
/// allows git 120 s, so this only catches a wedged process.
const LOCAL_TIMEOUT: Duration = Duration::from_mins(2);
/// Fetch and push against Artifacts. A first fetch transfers the whole trunk; 5 minutes is far
/// beyond that for the arena and still bounds a stalled connection.
const REMOTE_TIMEOUT: Duration = Duration::from_mins(5);
/// Characters of git's stderr kept in an error (the harness keeps 2,000).
const MAX_DETAIL_CHARS: usize = 2000;

/// Runs git with a fixed, isolated environment.
#[derive(Debug)]
pub(crate) struct Git {
    env: ChildEnv,
}

impl Git {
    pub(crate) fn new(inherited: &ChildEnv, identity: &CommitIdentity) -> Self {
        let env = inherited
            .without_prefixes(&["GIT_", "SSH_ASKPASS"])
            .with("GIT_CONFIG_NOSYSTEM", "1")
            .with("GIT_CONFIG_GLOBAL", "/dev/null")
            .with("GIT_TERMINAL_PROMPT", "0")
            .with("LC_ALL", "C")
            .with("GIT_AUTHOR_NAME", identity.name())
            .with("GIT_AUTHOR_EMAIL", identity.email())
            .with("GIT_COMMITTER_NAME", identity.name())
            .with("GIT_COMMITTER_EMAIL", identity.email());
        Self { env }
    }

    /// A `git <subcommand>` run with `cwd` as its working directory (a bare repository).
    pub(crate) fn command<'a>(&'a self, cwd: &'a Path, subcommand: &'static str) -> GitCommand<'a> {
        GitCommand {
            git: self,
            cwd,
            subcommand,
            args: Vec::new(),
            config: Vec::new(),
            env: Vec::new(),
            stdin: None,
            remote: None,
        }
    }
}

/// One git invocation, built up and then run with [`GitCommand::output`] or
/// [`GitCommand::success`].
#[derive(Debug)]
pub(crate) struct GitCommand<'a> {
    git: &'a Git,
    cwd: &'a Path,
    subcommand: &'static str,
    args: Vec<OsString>,
    config: Vec<(String, String)>,
    env: Vec<(OsString, OsString)>,
    stdin: Option<&'a [u8]>,
    remote: Option<&'a Remote>,
}

impl<'a> GitCommand<'a> {
    #[must_use]
    pub(crate) fn arg(mut self, arg: impl AsRef<OsStr>) -> Self {
        self.args.push(arg.as_ref().to_owned());
        self
    }

    #[must_use]
    pub(crate) fn args<I, S>(mut self, args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        self.args
            .extend(args.into_iter().map(|arg| arg.as_ref().to_owned()));
        self
    }

    /// A `-c key=value` for this command only.
    #[must_use]
    pub(crate) fn config(mut self, key: &str, value: impl Into<String>) -> Self {
        self.config.push((key.to_owned(), value.into()));
        self
    }

    #[must_use]
    pub(crate) fn env(mut self, key: &str, value: impl AsRef<OsStr>) -> Self {
        self.env.push((key.into(), value.as_ref().to_owned()));
        self
    }

    #[must_use]
    pub(crate) fn stdin(mut self, input: &'a [u8]) -> Self {
        self.stdin = Some(input);
        self
    }

    /// Talks to `remote`: sends its token, redacts it from output, allows network time, and
    /// reports failures as [`Error::Remote`].
    #[must_use]
    pub(crate) fn remote(mut self, remote: &'a Remote) -> Self {
        self.remote = Some(remote);
        self
    }

    /// Runs the command to completion, whatever its exit code.
    ///
    /// # Errors
    ///
    /// [`Error::Io`] when git cannot start, [`Error::Timeout`] when it runs too long.
    pub(crate) async fn output(self) -> Result<GitOutput> {
        let timeout = if self.remote.is_some() {
            REMOTE_TIMEOUT
        } else {
            LOCAL_TIMEOUT
        };
        let mut args = vec![OsString::from(self.subcommand)];
        args.extend(self.args);
        let mut extra_env = self.env;
        extra_env.extend(config_env(self.config, self.remote));
        let spec = ProcessSpec {
            program: OsStr::new("git"),
            args: &args,
            cwd: self.cwd,
            env: &self.git.env,
            extra_env: &extra_env,
            stdin: self.stdin,
            timeout,
        };
        let finished = process::run(&spec)
            .await
            .map_err(Error::io(format!("starting git {}", self.subcommand)))?;
        if finished.timed_out {
            return Err(Error::Timeout {
                op: self.subcommand,
                seconds: timeout.as_secs(),
            });
        }
        let stderr = String::from_utf8_lossy(&finished.stderr);
        Ok(GitOutput {
            subcommand: self.subcommand,
            code: finished.code,
            stdout: finished.stdout,
            stderr: match self.remote {
                Some(remote) => remote.token.redact(&stderr),
                None => stderr.into_owned(),
            },
            remote: self.remote.map(|remote| remote.url.to_string()),
        })
    }

    /// Runs the command and requires exit code 0.
    ///
    /// # Errors
    ///
    /// As [`GitCommand::output`], plus [`Error::Remote`] or [`Error::Git`] on a non-zero exit.
    pub(crate) async fn success(self) -> Result<GitOutput> {
        let output = self.output().await?;
        if output.succeeded() {
            Ok(output)
        } else {
            Err(output.failure())
        }
    }
}

/// Renders per-command config as `GIT_CONFIG_*` variables; the token header is added here, at
/// the last moment, so it lives in no struct that could be logged.
fn config_env(
    mut config: Vec<(String, String)>,
    remote: Option<&Remote>,
) -> Vec<(OsString, OsString)> {
    if let Some(remote) = remote {
        config.push((
            "http.extraHeader".to_owned(),
            remote.token.authorization_header(),
        ));
    }
    let mut env = vec![(
        OsString::from("GIT_CONFIG_COUNT"),
        OsString::from(config.len().to_string()),
    )];
    for (index, (key, value)) in config.into_iter().enumerate() {
        env.push((format!("GIT_CONFIG_KEY_{index}").into(), key.into()));
        env.push((format!("GIT_CONFIG_VALUE_{index}").into(), value.into()));
    }
    env
}

/// What a finished git command printed. `stderr` is already redacted.
#[derive(Debug)]
pub(crate) struct GitOutput {
    subcommand: &'static str,
    code: Option<i32>,
    stdout: Vec<u8>,
    stderr: String,
    remote: Option<String>,
}

impl GitOutput {
    pub(crate) fn succeeded(&self) -> bool {
        self.code == Some(0)
    }

    pub(crate) fn code(&self) -> Option<i32> {
        self.code
    }

    pub(crate) fn stdout(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }

    pub(crate) fn stderr(&self) -> &str {
        &self.stderr
    }

    /// The error this output stands for, as [`Error::Remote`] for network commands.
    pub(crate) fn failure(&self) -> Error {
        let mut detail = self.stderr.trim().to_owned();
        if self.subcommand == "push" {
            // `push --porcelain` gives the reason each ref was refused on stdout, flagged `!`.
            for rejected in self.stdout().lines().filter(|line| line.starts_with('!')) {
                detail.push('\n');
                detail.push_str(rejected);
            }
        }
        let detail = if detail.is_empty() {
            format!("exit status {:?}", self.code)
        } else {
            detail.chars().take(MAX_DETAIL_CHARS).collect()
        };
        match &self.remote {
            Some(repo) => Error::Remote {
                op: self.subcommand,
                repo: repo.clone(),
                detail,
            },
            None => Error::Git {
                op: self.subcommand,
                detail,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

    use super::*;

    #[test]
    fn config_reaches_git_through_the_environment() {
        let env = config_env(
            vec![("core.attributesFile".to_owned(), "/a".to_owned())],
            None,
        );

        assert_eq!(
            env,
            vec![
                ("GIT_CONFIG_COUNT".into(), "1".into()),
                ("GIT_CONFIG_KEY_0".into(), "core.attributesFile".into()),
                ("GIT_CONFIG_VALUE_0".into(), "/a".into()),
            ]
        );
    }

    #[test]
    fn remote_failures_name_the_remote_and_keep_git_detail() {
        let output = GitOutput {
            subcommand: "fetch",
            code: Some(128),
            stdout: Vec::new(),
            stderr: "fatal: Authentication failed\n".to_owned(),
            remote: Some("https://h/r.git".to_owned()),
        };

        let error = output.failure().to_string();

        assert!(error.contains("https://h/r.git"));
        assert!(error.contains("Authentication failed"));
    }
}
