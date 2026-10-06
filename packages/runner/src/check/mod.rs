//! `POST /v1/check`: the harness's `CI.run` on one commit (checkout, extra files, the run's
//! suite command, junit parsing, read sets, stack files, emulated latency), with the run's
//! dependency snapshot linked above the checkout and a loopback-only network.

mod deps;
mod imports;
mod junit;
mod paths;
mod report;
mod sandbox;
mod stack;
mod suite;

use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant};

pub(crate) use deps::DepsName;
pub(crate) use imports::ImportDepths;
pub(crate) use report::{CheckReport, FailingTest};
pub(crate) use sandbox::SuiteNetwork;
pub(crate) use suite::{SuiteCommand, SuiteEnv, SuiteLimits};

use crate::error::{Error, Result};
use crate::git::{CommitSha, Remote};
use crate::workspace::Workspace;

/// A file written into the checkout before the run (the final acceptance check's tests).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ExtraFile {
    path: PathBuf,
    content: String,
}

impl ExtraFile {
    /// # Errors
    ///
    /// A reason when `path` is absolute or climbs out of the checkout.
    pub(crate) fn new(path: &str, content: String) -> Result<Self, String> {
        let candidate = Path::new(path);
        let parts: Vec<Component<'_>> = candidate.components().collect();
        let stays_inside = !path.contains('\0')
            && parts
                .iter()
                .all(|part| matches!(part, Component::Normal(_) | Component::CurDir))
            && parts
                .iter()
                .any(|part| matches!(part, Component::Normal(_)));
        if stays_inside {
            Ok(Self {
                path: candidate.to_path_buf(),
                content,
            })
        } else {
            Err(format!(
                "{path:?} must be a relative path inside the checkout"
            ))
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct CheckRequest {
    pub(crate) trunk: Remote,
    pub(crate) sha: CommitSha,
    pub(crate) command: SuiteCommand,
    /// Variables set for the suite on top of the runner's (`NODE_OPTIONS`, say).
    pub(crate) env: SuiteEnv,
    /// The dependency snapshot linked above the checkout (`None`: no dependencies).
    pub(crate) deps: Option<DepsName>,
    pub(crate) extra_files: Vec<ExtraFile>,
    /// Emulated CI latency: the request holds its slot this long after the suite, as `ci.py`
    /// sleeps while the slot stays busy.
    pub(crate) latency: Duration,
    pub(crate) limits: SuiteLimits,
    pub(crate) read_sets: ReadSets,
}

/// Which test files get their read set reported.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum ReadSets {
    /// The failing ones only (the harness's `CIResult.read_sets`).
    #[default]
    Failing,
    /// The passing ones too, in `passing_read_sets` (the gateway's targeted landing check).
    All,
}

/// Runs the suite on `request.sha` and reports as `ci.py` does.
///
/// # Errors
///
/// Unknown commits, remote and git failures, an unknown dependency snapshot, a required
/// loopback network the kernel cannot give, and a node that cannot start. A red, crashed or
/// timed-out suite is a report, not an error.
pub(crate) async fn check(workspace: &Workspace, request: &CheckRequest) -> Result<CheckReport> {
    let started = Instant::now();
    if workspace.suite_network() == SuiteNetwork::Unavailable {
        return Err(Error::Config(
            "SUITE_NETWORK=loopback, but this instance cannot make a network namespace".to_owned(),
        ));
    }
    let node_modules = match &request.deps {
        Some(name) => Some(deps::node_modules(workspace.deps_dir(), name).await?),
        None => None,
    };
    let cache = workspace.open_trunk(&request.trunk).await?;
    cache.ensure_commits(&[&request.sha]).await?;
    let job = workspace.new_job().await?;
    let checkout = job.path().join("checkout");
    let junit = job.path().join("junit.xml");
    tokio::fs::create_dir(&checkout)
        .await
        .map_err(Error::io(format!("creating {}", checkout.display())))?;
    cache
        .repo()
        .checkout(&request.sha, &job.path().join("index"), &checkout)
        .await?;
    write_extra_files(&checkout, &request.extra_files).await?;
    if let Some(node_modules) = &node_modules {
        deps::link_above(job.path(), node_modules).await?;
    }
    let plan = suite::SuitePlan {
        command: &request.command,
        limits: request.limits,
        checkout: &checkout,
        junit: &junit,
        env: workspace.suite_env(),
        extra_env: &request.env,
        network: workspace.suite_network(),
    };
    let run = suite::run_suite(&plan).await?;
    let sha = request.sha.clone();
    let read_sets = request.read_sets;
    let mut report = tokio::task::spawn_blocking(move || {
        let mut report = report::assess(sha, &run, &checkout, &junit);
        if read_sets == ReadSets::All {
            report::record_passing_read_sets(&mut report, &checkout);
        }
        report
    })
    .await
    .map_err(|error| Error::io("reading the test results")(std::io::Error::other(error)))?;
    tokio::time::sleep(request.latency).await;
    report.ci_seconds = started.elapsed().as_secs_f64();
    report.network = workspace.suite_network();
    job.remove().await;
    Ok(report)
}

async fn write_extra_files(checkout: &Path, files: &[ExtraFile]) -> Result<()> {
    for file in files {
        let full = checkout.join(&file.path);
        if let Some(parent) = full.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(Error::io(format!("creating {}", parent.display())))?;
        }
        tokio::fs::write(&full, &file.content)
            .await
            .map_err(Error::io(format!("writing {}", full.display())))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extra_files_stay_inside_the_checkout() {
        assert!(ExtraFile::new("src/billing/t001.test.ts", String::new()).is_ok());
        assert!(ExtraFile::new("/etc/passwd", String::new()).is_err());
        assert!(ExtraFile::new("../outside.ts", String::new()).is_err());
        assert!(ExtraFile::new("src/../../outside.ts", String::new()).is_err());
        assert!(ExtraFile::new("./src/a.ts", String::new()).is_ok());
        assert!(ExtraFile::new(".", String::new()).is_err());
        assert!(ExtraFile::new("", String::new()).is_err());
    }
}
