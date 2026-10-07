//! Running the test suite: `node --test` with the reporters and timeouts the harness's `ci.py`
//! uses.

use std::ffi::{OsStr, OsString};
use std::path::Path;
use std::time::Duration;

use super::trace;
use crate::error::{Error, Result};
use crate::process::{self, ChildEnv, ProcessSpec};

/// `RaceConfig.suite_timeout`: the whole suite run.
pub(crate) const DEFAULT_SUITE_TIMEOUT: Duration = Duration::from_mins(5);
/// `CI.test_timeout_ms`: one test.
pub(crate) const DEFAULT_TEST_TIMEOUT_MS: u64 = 60_000;
/// Node options whose value is the next argument when not written `--option=value`, so the
/// value is not mistaken for a test file pattern.
const OPTIONS_WITH_VALUE: [&str; 17] = [
    "-r",
    "--require",
    "--import",
    "--loader",
    "--experimental-loader",
    "-C",
    "--conditions",
    "--input-type",
    "--env-file",
    "--test-name-pattern",
    "--test-skip-pattern",
    "--test-reporter",
    "--test-reporter-destination",
    "--test-concurrency",
    "--test-shard",
    "--test-isolation",
    "--test-global-setup",
];

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

    pub(crate) fn program(&self) -> &str {
        &self.program
    }

    /// Whether the command runs node's test runner (`--test`), the only kind whose files can be
    /// run one at a time.
    pub(crate) fn runs_tests(&self) -> bool {
        self.split().0.contains(&"--test")
    }

    /// The test file patterns the command names (none: node's default patterns).
    pub(crate) fn patterns(&self) -> Vec<String> {
        self.split().1.into_iter().map(str::to_owned).collect()
    }

    /// The same node options, running exactly `files` instead of the command's patterns.
    #[must_use]
    pub(crate) fn for_files(&self, files: &[String]) -> Self {
        let (options, _) = self.split();
        let mut args: Vec<String> = options.into_iter().map(str::to_owned).collect();
        args.push("--".to_owned());
        args.extend(files.iter().cloned());
        Self {
            program: self.program.clone(),
            args,
        }
    }

    /// The node options without the patterns, for running node on something else (discovery).
    pub(crate) fn options(&self) -> Vec<String> {
        self.split().0.into_iter().map(str::to_owned).collect()
    }

    /// Options (with their values) and positional arguments (test file patterns).
    fn split(&self) -> (Vec<&str>, Vec<&str>) {
        let mut options = Vec::new();
        let mut positional = Vec::new();
        let mut args = self.args.iter().map(String::as_str);
        while let Some(arg) = args.next() {
            if arg == "--" {
                positional.extend(args.by_ref());
            } else if arg.starts_with('-') && arg.len() > 1 {
                options.push(arg);
                if OPTIONS_WITH_VALUE.contains(&arg) {
                    options.extend(args.next());
                }
            } else {
                positional.push(arg);
            }
        }
        (options, positional)
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
    /// Run under strace, one log per process in this directory ([`super::trace`]).
    pub(crate) trace_into: Option<&'a Path>,
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
    let (program, args) = match plan.trace_into {
        Some(log_dir) => trace::wrap(log_dir, OsStr::new(&plan.command.program), &args),
        None => (OsString::from(&plan.command.program), args),
    };
    let spec = ProcessSpec {
        program: &program,
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

    fn command(extra: &[&str]) -> SuiteCommand {
        let mut argv = vec!["node".to_owned()];
        argv.extend(extra.iter().map(|arg| (*arg).to_owned()));
        SuiteCommand::parse(argv).unwrap()
    }

    #[test]
    fn patterns_are_the_positional_arguments() {
        let suite = command(&[
            "--no-use-env-proxy",
            "--import",
            "./setup.mjs",
            "--test",
            "test/!(listen.5).test.js",
            "test/**/*.test.mjs",
        ]);

        assert!(suite.runs_tests());
        assert_eq!(
            suite.patterns(),
            ["test/!(listen.5).test.js", "test/**/*.test.mjs"]
        );
        assert_eq!(
            suite.options(),
            ["--no-use-env-proxy", "--import", "./setup.mjs", "--test"]
        );
    }

    #[test]
    fn for_files_keeps_the_options_and_replaces_the_patterns() {
        let suite = command(&["--test", "--test-name-pattern", "x", "test/**/*.js"]);

        let one = suite.for_files(&["test/a.test.js".to_owned(), "-odd.test.js".to_owned()]);

        assert_eq!(
            one.args,
            [
                "--test",
                "--test-name-pattern",
                "x",
                "--",
                "test/a.test.js",
                "-odd.test.js"
            ]
        );
        assert_eq!(one.patterns(), ["test/a.test.js", "-odd.test.js"]);
        assert!(!command(&["script.js"]).runs_tests());
        assert!(command(&["--test"]).patterns().is_empty());
    }

    #[test]
    fn accepts_node_by_path_and_refuses_other_programs() {
        assert!(SuiteCommand::parse(vec!["/usr/local/bin/node".into(), "--test".into()]).is_ok());
        assert!(SuiteCommand::parse(vec!["npm".into(), "test".into()]).is_err());
        assert!(SuiteCommand::parse(Vec::new()).is_err());
    }
}
