//! What a traced check reports per test file: its outcome, the repo paths it read, probed and
//! listed, the packages it loaded, and the blob ids of the files it read.

use std::collections::BTreeMap;

use super::per_file::FileRun;
use super::trace::RepoAccesses;
use super::tree::TreeManifest;

/// The read maps of one check.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ReadMapsReport {
    pub(crate) status: TraceStatus,
    /// Keys every map: maps made under another toolchain are stale.
    pub(crate) environment: Option<String>,
    pub(crate) files: Vec<TestFileMap>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TraceStatus {
    Traced,
    /// The check ran untraced; the reason says why (strace missing or not permitted).
    Unavailable(String),
}

/// One test file's map.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TestFileMap {
    pub(crate) file: String,
    pub(crate) passed: bool,
    pub(crate) tests: usize,
    pub(crate) failures: usize,
    pub(crate) seconds: f64,
    pub(crate) timed_out: bool,
    /// `None`: the trace could not be read; the file counts as unmapped.
    pub(crate) accesses: Option<RepoAccesses>,
    /// Blob ids of the read files that are files of the checked tree.
    pub(crate) hashes: BTreeMap<String, String>,
}

impl ReadMapsReport {
    pub(crate) fn unavailable(reason: &str) -> Self {
        Self {
            status: TraceStatus::Unavailable(reason.to_owned()),
            environment: None,
            files: Vec::new(),
        }
    }

    /// The maps of traced `runs`, hashed against `tree`.
    pub(crate) fn traced(runs: &[FileRun], tree: &TreeManifest, environment: &str) -> Self {
        Self {
            status: TraceStatus::Traced,
            environment: Some(environment.to_owned()),
            files: runs.iter().map(|run| file_map(run, tree)).collect(),
        }
    }
}

fn file_map(run: &FileRun, tree: &TreeManifest) -> TestFileMap {
    let (tests, failures) = run
        .junit
        .as_ref()
        .map_or((0, 0), |summary| (summary.tests, summary.failing.len()));
    let hashes = run
        .accesses
        .as_ref()
        .map(|accesses| tree.hashes_of(&accesses.reads))
        .unwrap_or_default();
    TestFileMap {
        file: run.file.clone(),
        passed: run.passed(),
        tests,
        failures,
        seconds: run.run.seconds,
        timed_out: run.run.timed_out,
        accesses: run.accesses.clone(),
        hashes,
    }
}
