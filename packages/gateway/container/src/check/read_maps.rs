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

/// What traced per-file runs tell the engine's evidence rule (`v2-evidence.ts`): every file that
/// ran, split by outcome, and each passing file's observed read set; `complete` only when every
/// file that ran was traced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ObservedReadSets {
    pub(crate) passing_files: Vec<String>,
    pub(crate) failing_files: Vec<String>,
    pub(crate) passing_read_sets: BTreeMap<String, Vec<String>>,
    pub(crate) complete: bool,
}

impl ObservedReadSets {
    pub(crate) fn of(runs: &[FileRun]) -> Self {
        let mut observed = Self {
            passing_files: Vec::new(),
            failing_files: Vec::new(),
            passing_read_sets: BTreeMap::new(),
            complete: !runs.is_empty() && runs.iter().all(|run| run.accesses.is_some()),
        };
        for run in runs {
            if !run.passed() {
                observed.failing_files.push(run.file.clone());
                continue;
            }
            observed.passing_files.push(run.file.clone());
            if let Some(accesses) = &run.accesses {
                observed
                    .passing_read_sets
                    .insert(run.file.clone(), read_set(&run.file, accesses));
            }
        }
        observed.passing_files.sort();
        observed.failing_files.sort();
        observed
    }
}

/// One file's observed read set in the engine's vocabulary: the file itself, every path it read
/// or looked for and missed (an added file there is seen), and each directory it listed or
/// package it loaded as a `dir/` entry (anything changed below it is seen).
#[must_use]
pub(crate) fn read_set(file: &str, accesses: &RepoAccesses) -> Vec<String> {
    let mut set: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    set.insert(file.to_owned());
    set.extend(accesses.reads.iter().cloned());
    set.extend(accesses.probes.iter().cloned());
    set.extend(accesses.dirs.iter().map(|dir| format!("{dir}/")));
    set.extend(
        accesses
            .packages
            .iter()
            .map(|package| format!("{package}/")),
    );
    set.into_iter().collect()
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::check::junit::JunitSummary;
    use crate::check::suite::SuiteRun;

    fn run(file: &str, code: Option<i32>, accesses: Option<RepoAccesses>) -> FileRun {
        FileRun {
            file: file.to_owned(),
            run: SuiteRun {
                code,
                stdout: String::new(),
                stderr: String::new(),
                timed_out: false,
                seconds: 0.1,
            },
            junit: Some(JunitSummary::default()),
            accesses,
        }
    }

    fn accesses() -> RepoAccesses {
        let set = |paths: &[&str]| paths.iter().map(|path| (*path).to_owned()).collect();
        RepoAccesses {
            reads: set(&["src/a.ts", "tests/fixtures/rates.json"]),
            probes: set(&["src/package.json"]),
            dirs: set(&["tests/snapshots"]),
            packages: set(&["node_modules/pino"]),
        }
    }

    #[test]
    fn a_read_set_holds_reads_probes_and_listed_directories() {
        assert_eq!(
            read_set("src/a.test.ts", &accesses()),
            [
                "node_modules/pino/",
                "src/a.test.ts",
                "src/a.ts",
                "src/package.json",
                "tests/fixtures/rates.json",
                "tests/snapshots/",
            ]
        );
    }

    #[test]
    fn read_sets_are_complete_only_when_every_file_was_traced() {
        let traced = [
            run("b.test.ts", Some(0), Some(accesses())),
            run("a.test.ts", Some(1), Some(accesses())),
        ];
        let partly = [
            run("b.test.ts", Some(0), Some(accesses())),
            run("c.test.ts", Some(0), None),
        ];

        let observed = ObservedReadSets::of(&traced);

        assert!(observed.complete);
        assert_eq!(observed.passing_files, ["b.test.ts"]);
        assert_eq!(observed.failing_files, ["a.test.ts"]);
        assert_eq!(
            observed.passing_read_sets.keys().collect::<Vec<_>>(),
            ["b.test.ts"]
        );
        assert!(!ObservedReadSets::of(&partly).complete);
        assert!(!ObservedReadSets::of(&[]).complete);
    }
}
