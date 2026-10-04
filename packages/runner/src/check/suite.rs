//! Running the test suite: `node --test` with the reporters and timeouts the harness's `ci.py`
//! uses.

use std::ffi::{OsStr, OsString};
use std::path::Path;
use std::time::Duration;

use crate::error::{Error, Result};
use crate::process::{self, ChildEnv, ProcessSpec};

/// `RaceConfig.suite_timeout`: the whole suite run.
pub(crate) const DEFAULT_SUITE_TIMEOUT: Duration = Duration::from_mins(5);
/// `CI.test_timeout_ms`: one test.
pub(crate) const DEFAULT_TEST_TIMEOUT_MS: u64 = 60_000;

/// The test command: `node` and its arguments (default `node --test`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SuiteCommand {
    program: String,
    args: Vec<String>,
}

impl SuiteCommand {
    /// # Errors
    ///
    /// A reason when `argv` is empty or does not run `node` (the runner reads node's junit
    /// reporter, so nothing else can report results).
    pub(crate) fn parse(argv: Vec<String>) -> Result<Self, String> {
        let mut parts = argv.into_iter();
        let Some(program) = parts.next() else {
            return Err("cmd is empty".to_owned());
        };
        if Path::new(&program).file_name() != Some(OsStr::new("node")) {
            return Err(format!("cmd must run node, not {program:?}"));
        }
        Ok(Self {
            program,
            args: parts.collect(),
        })
    }

    pub(crate) fn node_test() -> Self {
        Self {
            program: "node".to_owned(),
            args: vec!["--test".to_owned()],
        }
    }

    /// The command with the harness's flags put right after `node`, so they apply however the
    /// caller's arguments end: one test's timeout, a spec log on stdout, junit into `junit`.
    fn argv(&self, junit: &Path, test_timeout_ms: u64) -> Vec<OsString> {
        let mut junit_destination = OsString::from("--test-reporter-destination=");
        junit_destination.push(junit);
        let mut argv: Vec<OsString> = vec![
            format!("--test-timeout={test_timeout_ms}").into(),
            "--test-reporter=spec".into(),
            "--test-reporter-destination=stdout".into(),
            "--test-reporter=junit".into(),
            junit_destination,
        ];
        argv.extend(self.args.iter().map(OsString::from));
        argv
    }
}

/// Limits on one suite run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SuiteLimits {
    pub(crate) suite_timeout: Duration,
    pub(crate) test_timeout_ms: u64,
}

impl Default for SuiteLimits {
    fn default() -> Self {
        Self {
            suite_timeout: DEFAULT_SUITE_TIMEOUT,
            test_timeout_ms: DEFAULT_TEST_TIMEOUT_MS,
        }
    }
}

/// Where and how to run the suite.
#[derive(Debug)]
pub(crate) struct SuitePlan<'a> {
    pub(crate) command: &'a SuiteCommand,
    pub(crate) limits: SuiteLimits,
    pub(crate) checkout: &'a Path,
    pub(crate) junit: &'a Path,
    pub(crate) env: &'a ChildEnv,
}

/// What the suite process did.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SuiteRun {
    /// `None` when it timed out or was killed.
    pub(crate) code: Option<i32>,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) timed_out: bool,
    pub(crate) seconds: f64,
}

/// Runs the suite in `plan.checkout`; a timeout kills the whole process tree.
///
/// # Errors
///
/// [`Error::Io`] when node cannot be started.
pub(crate) async fn run_suite(plan: &SuitePlan<'_>) -> Result<SuiteRun> {
    let args = plan.command.argv(plan.junit, plan.limits.test_timeout_ms);
    let spec = ProcessSpec {
        program: OsStr::new(&plan.command.program),
        args: &args,
        cwd: plan.checkout,
        env: plan.env,
        extra_env: &[],
        stdin: None,
        timeout: plan.limits.suite_timeout,
    };
    let finished = process::run(&spec)
        .await
        .map_err(Error::io(format!("starting {}", plan.command.program)))?;
    Ok(SuiteRun {
        code: finished.code,
        stdout: String::from_utf8_lossy(&finished.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&finished.stderr).into_owned(),
        timed_out: finished.timed_out,
        seconds: finished.elapsed.as_secs_f64(),
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

    use super::*;

    #[test]
    fn the_default_command_gets_the_harness_reporters() {
        let argv = SuiteCommand::node_test().argv(Path::new("/j/junit.xml"), 60_000);

        assert_eq!(
            argv,
            [
                "--test-timeout=60000",
                "--test-reporter=spec",
                "--test-reporter-destination=stdout",
                "--test-reporter=junit",
                "--test-reporter-destination=/j/junit.xml",
                "--test",
            ]
            .map(OsString::from)
        );
    }

    #[test]
    fn accepts_node_by_path_and_refuses_other_programs() {
        assert!(SuiteCommand::parse(vec!["/usr/local/bin/node".into(), "--test".into()]).is_ok());
        assert!(SuiteCommand::parse(vec!["npm".into(), "test".into()]).is_err());
        assert!(SuiteCommand::parse(Vec::new()).is_err());
    }
}
