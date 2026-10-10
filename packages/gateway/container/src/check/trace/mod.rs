//! Per-test-file read maps: each test file runs as its own process tree under
//! `strace --seccomp-bpf`, and the files it read, probed and listed are attributed to it. The
//! method and its evidence are `research/test-impact/README.md` (298/298 mutations caught across
//! five languages); "Read maps in the runner" there describes this port.
//!
//! One process per file is required for attribution: every runtime caches loaded modules, so a
//! second file in a shared process would not re-read what the first one loaded.

mod attribute;
mod parse;

use std::ffi::{OsStr, OsString};
use std::path::Path;
use std::time::Duration;

pub(crate) use attribute::{CheckoutRoots, RepoAccesses, attribute};
pub(crate) use parse::{ProcessLog, parse_logs};

use crate::error::{Error, Result};
use crate::process::{self, ChildEnv, ProcessSpec};

const STRACE: &str = "strace";
/// File, process and directory-change calls only; `--seccomp-bpf` stops the tracee on nothing
/// else, which is most of the saving over plain ptrace.
const STRACE_FLAGS: [&str; 10] = [
    "-f",
    "-ff",
    "--seccomp-bpf",
    "-qq",
    "-y",
    "-s",
    "4096",
    "-e",
    "trace=%file,%process,chdir,fchdir",
    "-o",
];
/// The probe traces `true`; this only bounds a broken binary.
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);
/// Each process's log is `<prefix>.<pid>`.
const LOG_PREFIX: &str = "t";

/// Whether this instance can trace, decided once at startup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Tracer {
    /// strace works here; `environment` keys every map this instance makes (node, strace and
    /// runner versions), so a map from another toolchain reads as stale.
    Ready { environment: String },
    /// A traced check runs untraced and says why.
    Unavailable { reason: String },
}

impl Tracer {
    /// Traces `true` once: strace must exist and be allowed to ptrace with a seccomp filter.
    pub(crate) async fn probe(env: &ChildEnv, versions: &str) -> Self {
        let args: Vec<OsString> = ["-f", "-qq", "--seccomp-bpf", "-e", "trace=execve", "-o"]
            .into_iter()
            .map(OsString::from)
            .chain(["/dev/null", "--", "true"].map(OsString::from))
            .collect();
        let spec = ProcessSpec {
            program: OsStr::new(STRACE),
            args: &args,
            cwd: Path::new("/"),
            env,
            extra_env: &[],
            stdin: None,
            timeout: PROBE_TIMEOUT,
        };
        match process::run(&spec).await {
            Ok(finished) if finished.succeeded() => Self::Ready {
                environment: versions.to_owned(),
            },
            Ok(finished) => Self::Unavailable {
                reason: format!(
                    "strace cannot trace here: {}",
                    String::from_utf8_lossy(&finished.stderr).trim()
                ),
            },
            Err(error) => Self::Unavailable {
                reason: format!("strace is not installed: {error}"),
            },
        }
    }

    pub(crate) fn is_ready(&self) -> bool {
        matches!(self, Self::Ready { .. })
    }
}

/// `program args` wrapped so strace writes one log per process under `log_dir`.
pub(crate) fn wrap(
    log_dir: &Path,
    program: &OsStr,
    args: &[OsString],
) -> (OsString, Vec<OsString>) {
    let mut wrapped: Vec<OsString> = STRACE_FLAGS.iter().map(OsString::from).collect();
    wrapped.push(log_dir.join(LOG_PREFIX).into_os_string());
    wrapped.push("--".into());
    wrapped.push(program.to_owned());
    wrapped.extend(args.iter().cloned());
    (OsString::from(STRACE), wrapped)
}

/// Reads every process log strace wrote into `log_dir`. Blocking: call it on a blocking thread.
///
/// # Errors
///
/// [`Error::Io`] when the directory cannot be read.
pub(crate) fn read_logs(log_dir: &Path) -> Result<Vec<ProcessLog>> {
    let entries =
        std::fs::read_dir(log_dir).map_err(Error::io(format!("reading {}", log_dir.display())))?;
    let mut logs = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let pid = name
            .to_str()
            .and_then(|name| name.strip_prefix(LOG_PREFIX))
            .and_then(|rest| rest.strip_prefix('.'))
            .and_then(|pid| pid.parse::<u32>().ok());
        let Some(pid) = pid else {
            continue;
        };
        let bytes = std::fs::read(entry.path())
            .map_err(Error::io(format!("reading {}", entry.path().display())))?;
        logs.push(ProcessLog {
            pid,
            text: String::from_utf8_lossy(&bytes).into_owned(),
        });
    }
    Ok(logs)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

    use super::*;

    #[test]
    fn the_wrapped_command_runs_the_program_after_the_strace_flags() {
        let (program, args) = wrap(
            Path::new("/j/trace/3"),
            OsStr::new("node"),
            &["--test".into(), "a.test.ts".into()],
        );

        assert_eq!(program, "strace");
        let tail: Vec<&OsStr> = args.iter().map(OsString::as_os_str).collect();
        assert_eq!(
            tail[tail.len() - 5..],
            ["/j/trace/3/t", "--", "node", "--test", "a.test.ts"].map(OsStr::new)
        );
        assert!(tail.contains(&OsStr::new("--seccomp-bpf")));
    }

    #[test]
    fn reads_only_the_per_process_logs() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("t.12"), "chdir(\"/w\") = 0").unwrap();
        std::fs::write(dir.path().join("t.13"), "").unwrap();
        std::fs::write(dir.path().join("junit.xml"), "<x/>").unwrap();

        let mut logs = read_logs(dir.path()).unwrap();
        logs.sort_by_key(|log| log.pid);

        assert_eq!(logs.iter().map(|log| log.pid).collect::<Vec<_>>(), [12, 13]);
        assert_eq!(logs[0].text, "chdir(\"/w\") = 0");
    }
}
