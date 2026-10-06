//! The suite's network: loopback only. Tests may listen on and connect to local ports (fastify's
//! do), but nothing outside the instance answers. The container itself keeps internet egress
//! (git must reach Artifacts), so the suite runs in a network namespace of its own, made by
//! bubblewrap (`bwrap --unshare-net`, which brings up `lo`). Bubblewrap needs unprivileged user
//! namespaces; where the kernel refuses them (Docker's default seccomp profile), the policy says
//! whether the suite runs with the host's network or not at all.

use std::ffi::{OsStr, OsString};
use std::path::Path;
use std::time::Duration;

use serde::Serialize;

use crate::config::NetworkPolicy;
use crate::process::{self, ChildEnv, ProcessSpec};

/// The bubblewrap binary the image installs.
const BWRAP: &str = "bwrap";
/// The probe runs `true` in a namespace; this only bounds a broken binary.
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

/// The network a suite actually gets, reported on every check and by `/healthz`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SuiteNetwork {
    /// A namespace with `lo` only.
    Loopback,
    /// The instance's own network.
    Host,
    /// Loopback was required and is unavailable: checks are refused.
    Unavailable,
}

impl SuiteNetwork {
    /// Decides the suite's network once, at startup.
    pub(crate) async fn resolve(policy: NetworkPolicy, env: &ChildEnv) -> Self {
        if policy == NetworkPolicy::Host {
            return Self::Host;
        }
        let isolates = probe(env).await;
        match (isolates, policy) {
            (true, _) => Self::Loopback,
            (false, NetworkPolicy::Loopback) => Self::Unavailable,
            (false, _) => Self::Host,
        }
    }

    /// The program and arguments that run `program args` on this network.
    pub(crate) fn wrap(self, program: &str, args: Vec<OsString>) -> (OsString, Vec<OsString>) {
        match self {
            Self::Host | Self::Unavailable => (OsString::from(program), args),
            Self::Loopback => {
                let mut wrapped = bwrap_prefix();
                wrapped.push(OsString::from(program));
                wrapped.extend(args);
                (OsString::from(BWRAP), wrapped)
            }
        }
    }
}

/// The whole filesystem as it is (the checkout, node and the dependency snapshots), a user
/// namespace mapping the runner's own uid, and a network namespace with only `lo`.
fn bwrap_prefix() -> Vec<OsString> {
    [
        "--unshare-user",
        "--unshare-net",
        "--die-with-parent",
        "--dev-bind",
        "/",
        "/",
        "--",
    ]
    .map(OsString::from)
    .to_vec()
}

async fn probe(env: &ChildEnv) -> bool {
    let (program, args) = SuiteNetwork::Loopback.wrap("true", Vec::new());
    let spec = ProcessSpec {
        program: OsStr::new(&program),
        args: &args,
        cwd: Path::new("/"),
        env,
        extra_env: &[],
        stdin: None,
        timeout: PROBE_TIMEOUT,
    };
    match process::run(&spec).await {
        Ok(finished) if finished.succeeded() => true,
        Ok(finished) => {
            let stderr = String::from_utf8_lossy(&finished.stderr);
            tracing::warn!(stderr = %stderr.trim(), "no loopback-only network namespace for suites");
            false
        }
        Err(error) => {
            tracing::warn!(%error, "bwrap not found; suites cannot get a loopback-only network");
            false
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

    use super::*;

    #[test]
    fn loopback_runs_the_suite_inside_bwrap_with_its_argv_untouched() {
        let suite_args = vec![OsString::from("--test"), OsString::from("test/*.test.js")];

        let (program, argv) = SuiteNetwork::Loopback.wrap("node", suite_args);

        assert_eq!(program, "bwrap");
        assert_eq!(
            argv,
            [
                "--unshare-user",
                "--unshare-net",
                "--die-with-parent",
                "--dev-bind",
                "/",
                "/",
                "--",
                "node",
                "--test",
                "test/*.test.js",
            ]
            .map(OsString::from)
        );
    }

    #[test]
    fn host_runs_the_suite_directly() {
        let (program, argv) = SuiteNetwork::Host.wrap("node", vec![OsString::from("--test")]);

        assert_eq!(program, "node");
        assert_eq!(argv, [OsString::from("--test")]);
    }

    #[tokio::test]
    async fn the_host_policy_never_probes() {
        let network = SuiteNetwork::resolve(NetworkPolicy::Host, &ChildEnv::inherit()).await;

        assert_eq!(network, SuiteNetwork::Host);
    }
}
