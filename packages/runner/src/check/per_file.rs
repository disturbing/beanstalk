//! Running test files one process each (traced, for read maps), and folding their results back
//! into one suite run and one junit summary, so a traced check reports what an untraced one
//! does.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use super::junit::{self, JunitFailure, JunitSummary};
use super::sandbox::SuiteNetwork;
use super::suite::{self, SuiteCommand, SuiteEnv, SuiteLimits, SuitePlan, SuiteRun};
use super::trace::{self, CheckoutRoots, RepoAccesses};
use crate::error::{Error, Result};
use crate::process::ChildEnv;

/// Name of the failure recorded for a file whose run left no junit report.
const NO_REPORT_NAME: &str = "(the test file did not report)";
const NO_REPORT_MESSAGE: &str =
    "the test file crashed, was killed or timed out before node's reporter finished";

/// Everything a file's run needs, owned so runs can proceed in parallel.
#[derive(Debug)]
pub(crate) struct FilePlan {
    pub(crate) command: SuiteCommand,
    pub(crate) limits: SuiteLimits,
    pub(crate) checkout: PathBuf,
    /// The checkout through symlinks resolved (junit file names are resolved against it).
    pub(crate) checkout_real: PathBuf,
    pub(crate) job_dir: PathBuf,
    pub(crate) env: ChildEnv,
    /// The request's own variables, set on top of `env`.
    pub(crate) extra_env: SuiteEnv,
    pub(crate) network: SuiteNetwork,
    /// Files run at once.
    pub(crate) concurrency: usize,
}

/// One test file's run.
#[derive(Debug, Clone)]
pub(crate) struct FileRun {
    pub(crate) file: String,
    pub(crate) run: SuiteRun,
    /// `None` when the file left no well-formed report.
    pub(crate) junit: Option<JunitSummary>,
    /// `None` when its trace could not be read.
    pub(crate) accesses: Option<RepoAccesses>,
}

impl FileRun {
    pub(crate) fn passed(&self) -> bool {
        self.run.code == Some(0)
            && !self.run.timed_out
            && self
                .junit
                .as_ref()
                .is_some_and(|summary| summary.failing.is_empty())
    }
}

/// Runs every file of `files` traced, at most `plan.concurrency` at once, all within the
/// suite's timeout. Results come back in the order of `files`.
///
/// # Errors
///
/// [`Error::Io`] when node or strace cannot be started, or scratch space cannot be made.
pub(crate) async fn run_traced(plan: FilePlan, files: &[String]) -> Result<Vec<FileRun>> {
    let deadline = Instant::now() + plan.limits.suite_timeout;
    let gate = Arc::new(Semaphore::new(plan.concurrency.max(1)));
    let plan = Arc::new(plan);
    let mut running = JoinSet::new();
    for (index, file) in files.iter().enumerate() {
        let (plan, gate, file) = (Arc::clone(&plan), Arc::clone(&gate), file.clone());
        running.spawn(async move {
            let _slot = gate.acquire_owned().await;
            (index, run_one(&plan, index, file, deadline).await)
        });
    }
    let mut done: Vec<(usize, FileRun)> = Vec::with_capacity(files.len());
    while let Some(joined) = running.join_next().await {
        let (index, outcome) = joined.map_err(|error| join_error(&error))?;
        done.push((index, outcome?));
    }
    done.sort_by_key(|(index, _)| *index);
    Ok(done.into_iter().map(|(_, run)| run).collect())
}

fn join_error(error: &tokio::task::JoinError) -> Error {
    Error::io("running a test file")(std::io::Error::other(error.to_string()))
}

async fn run_one(
    plan: &FilePlan,
    index: usize,
    file: String,
    deadline: Instant,
) -> Result<FileRun> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        return Ok(out_of_time(file));
    }
    let junit = plan.job_dir.join(format!("junit-{index}.xml"));
    let log_dir = plan.job_dir.join("trace").join(index.to_string());
    tokio::fs::create_dir_all(&log_dir)
        .await
        .map_err(Error::io(format!("creating {}", log_dir.display())))?;
    let command = plan.command.for_files(std::slice::from_ref(&file));
    let suite_plan = SuitePlan {
        command: &command,
        limits: SuiteLimits {
            suite_timeout: remaining,
            ..plan.limits
        },
        checkout: &plan.checkout,
        junit: &junit,
        env: &plan.env,
        extra_env: &plan.extra_env,
        network: plan.network,
        trace_into: Some(&log_dir),
    };
    let run = suite::run_suite(&suite_plan).await?;
    let roots = CheckoutRoots::new(&path_text(&plan.checkout), &path_text(&plan.checkout_real));
    let checkout_real = plan.checkout_real.clone();
    let cwd = path_text(&plan.checkout);
    let (junit, accesses) = tokio::task::spawn_blocking(move || {
        let summary = std::fs::read_to_string(&junit)
            .ok()
            .and_then(|xml| junit::parse_junit(&xml, &checkout_real));
        let accesses = trace::read_logs(&log_dir)
            .ok()
            .map(|logs| trace::attribute(&trace::parse_logs(&logs, &cwd), &roots));
        // Logs can be megabytes; the job directory goes at the end, these go now.
        let _ = std::fs::remove_dir_all(&log_dir);
        (summary, accesses)
    })
    .await
    .map_err(|error| join_error(&error))?;
    Ok(FileRun {
        file,
        run,
        junit,
        accesses,
    })
}

fn out_of_time(file: String) -> FileRun {
    FileRun {
        file,
        run: SuiteRun {
            code: None,
            stdout: String::new(),
            stderr: String::new(),
            timed_out: true,
            seconds: 0.0,
        },
        junit: None,
        accesses: None,
    }
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// The file runs as one suite run and one junit summary: green only when every file passed;
/// a file that left no report counts as one failure of that file; the output is the failing
/// files' output.
#[must_use]
pub(crate) fn combine(runs: &[FileRun], wall: Duration) -> (SuiteRun, JunitSummary) {
    let code = if runs.iter().all(|file| file.run.code == Some(0)) {
        Some(0)
    } else {
        runs.iter()
            .filter_map(|file| file.run.code)
            .find(|code| *code != 0)
    };
    let mut summary = JunitSummary {
        failing: Vec::new(),
        passing_files: Vec::new(),
        tests: 0,
    };
    let mut stdout = String::new();
    let mut stderr = String::new();
    for file in runs {
        fold_report(&mut summary, file);
        if !file.passed() {
            stdout.push_str(&file.run.stdout);
            stderr.push_str(&file.run.stderr);
        }
    }
    summary.passing_files.sort();
    summary.passing_files.dedup();
    let run = SuiteRun {
        code,
        stdout,
        stderr,
        timed_out: runs.iter().any(|file| file.run.timed_out),
        seconds: wall.as_secs_f64(),
    };
    (run, summary)
}

fn fold_report(summary: &mut JunitSummary, file: &FileRun) {
    match &file.junit {
        Some(report) => {
            summary.tests += report.tests;
            summary.failing.extend(report.failing.iter().cloned());
            summary
                .passing_files
                .extend(report.passing_files.iter().cloned());
            if report.failing.is_empty() && !file.passed() {
                summary.failing.push(no_report(&file.file));
            }
        }
        None => summary.failing.push(no_report(&file.file)),
    }
}

fn no_report(file: &str) -> JunitFailure {
    JunitFailure {
        file: file.to_owned(),
        name: NO_REPORT_NAME.to_owned(),
        message: NO_REPORT_MESSAGE.to_owned(),
        body: String::new(),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

    use super::*;

    fn file_run(file: &str, code: Option<i32>, junit: Option<JunitSummary>) -> FileRun {
        FileRun {
            file: file.to_owned(),
            run: SuiteRun {
                code,
                stdout: format!("out of {file}\n"),
                stderr: String::new(),
                timed_out: code.is_none(),
                seconds: 0.5,
            },
            junit,
            accesses: None,
        }
    }

    fn passing(file: &str, tests: usize) -> JunitSummary {
        JunitSummary {
            failing: Vec::new(),
            passing_files: vec![file.to_owned()],
            tests,
        }
    }

    #[test]
    fn every_file_passing_is_green() {
        let runs = [
            file_run("b.test.ts", Some(0), Some(passing("b.test.ts", 2))),
            file_run("a.test.ts", Some(0), Some(passing("a.test.ts", 3))),
        ];

        let (run, summary) = combine(&runs, Duration::from_secs(2));

        assert_eq!(run.code, Some(0));
        assert!(!run.timed_out);
        assert_eq!(run.stdout, "");
        assert_eq!(summary.tests, 5);
        assert_eq!(summary.passing_files, ["a.test.ts", "b.test.ts"]);
        assert!(summary.failing.is_empty());
    }

    #[test]
    fn a_file_that_left_no_report_fails_that_file() {
        let runs = [
            file_run("a.test.ts", Some(0), Some(passing("a.test.ts", 1))),
            file_run("b.test.ts", None, None),
        ];

        let (run, summary) = combine(&runs, Duration::from_secs(2));

        assert_eq!(run.code, None);
        assert!(run.timed_out);
        assert_eq!(run.stdout, "out of b.test.ts\n");
        assert_eq!(summary.failing.len(), 1);
        assert_eq!(summary.failing[0].file, "b.test.ts");
        assert_eq!(summary.passing_files, ["a.test.ts"]);
    }

    #[test]
    fn a_nonzero_exit_with_a_clean_report_still_fails() {
        let runs = [file_run(
            "a.test.ts",
            Some(1),
            Some(passing("a.test.ts", 1)),
        )];

        let (run, summary) = combine(&runs, Duration::from_secs(1));

        assert_eq!(run.code, Some(1));
        assert_eq!(summary.failing[0].name, NO_REPORT_NAME);
        assert!(!runs[0].passed());
    }
}
