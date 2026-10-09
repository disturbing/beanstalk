//! What the restore and save steps share: the step's environment, the state handed from
//! restore to save, the step outputs and the log.

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::{Deserialize, Serialize};

use super::manifest::Match;
use crate::error::{Error, Result};

/// The step's view of its job, from act's environment.
#[derive(Debug, Clone)]
pub struct StepEnv {
    pub workspace: PathBuf,
    pub runner_temp: PathBuf,
    pub url: String,
    pub token: String,
    pub install_dir: String,
    pub flags: String,
    /// The job installs with `npm ci` (it deletes `node_modules` first).
    pub wipes_tree: bool,
    pub github_output: Option<PathBuf>,
    pub github_path: Option<PathBuf>,
}

impl StepEnv {
    /// # Errors
    ///
    /// [`Error::Config`] naming a variable act should have set.
    pub fn from_env() -> Result<Self> {
        let var = |name: &str| std::env::var(name).ok().filter(|value| !value.is_empty());
        let required =
            |name: &str| var(name).ok_or_else(|| Error::Config(format!("{name} is not set")));
        Ok(Self {
            workspace: PathBuf::from(required("GITHUB_WORKSPACE")?),
            runner_temp: var("RUNNER_TEMP").map_or_else(std::env::temp_dir, PathBuf::from),
            url: var("BEANSTALK_DEPS_URL").unwrap_or_else(|| super::plan::DEPS_URL.to_owned()),
            token: required(super::plan::TOKEN_SECRET)?,
            install_dir: var("BEANSTALK_DEPS_DIR").unwrap_or_else(|| ".".into()),
            flags: var("BEANSTALK_DEPS_FLAGS").unwrap_or_default(),
            wipes_tree: var("BEANSTALK_DEPS_WIPES_TREE").is_some(),
            github_output: var("GITHUB_OUTPUT").map(PathBuf::from),
            github_path: var("GITHUB_PATH").map(PathBuf::from),
        })
    }

    /// The install directory, absolute.
    pub fn install_path(&self) -> PathBuf {
        if self.install_dir == "." {
            self.workspace.clone()
        } else {
            self.workspace.join(&self.install_dir)
        }
    }

    /// The tool's own scratch directory for this job.
    pub fn state_dir(&self) -> PathBuf {
        self.runner_temp.join("beanstalk-deps")
    }

    /// Writes `name=value` to the step's outputs.
    pub fn set_output(&self, name: &str, value: &str) {
        if let Some(path) = &self.github_output {
            append(path, &format!("{name}={value}\n"));
        }
    }

    /// Puts `dir` first on PATH for the following steps.
    pub fn add_path(&self, dir: &Path) {
        if let Some(path) = &self.github_path {
            append(path, &format!("{}\n", dir.display()));
        }
    }
}

/// What the restore step leaves for the save step.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreState {
    pub install_dir: String,
    pub family_key: String,
    pub snapshot_key: String,
    pub lockfile: String,
    pub package_manager: String,
    pub platform: String,
    pub node_major: String,
    pub flags: String,
    #[serde(rename = "match")]
    pub matched: Match,
    pub chunk_count: Option<u32>,
    pub can_save: bool,
    pub snapshot_max_bytes: u64,
    /// Chunks the restore already had, so the save never asks about them again.
    pub restored_chunks: Vec<String>,
}

impl RestoreState {
    fn path(env: &StepEnv) -> PathBuf {
        env.state_dir().join("state.json")
    }

    /// # Errors
    ///
    /// [`Error::Io`] when the state cannot be written.
    pub fn store(&self, env: &StepEnv) -> Result<()> {
        std::fs::create_dir_all(env.state_dir())
            .map_err(Error::io("creating the state directory"))?;
        let text = serde_json::to_string(self).map_err(|error| Error::Config(error.to_string()))?;
        std::fs::write(Self::path(env), text).map_err(Error::io("writing the restore state"))
    }

    /// The restore step's state, or None when it did not run (or found nothing to cache).
    pub fn load(env: &StepEnv) -> Option<Self> {
        let text = std::fs::read_to_string(Self::path(env)).ok()?;
        serde_json::from_str(&text).ok()
    }
}

/// A line in the step's log.
pub fn say(text: &str) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{text}");
}

/// A machine-readable summary line (`beanstalk-deps: {...}`), which the measurements read.
pub fn report(value: &serde_json::Value) {
    say(&format!("beanstalk-deps: {value}"));
}

/// Milliseconds since `start`.
pub fn elapsed_ms(start: Instant) -> u64 {
    u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// `1.4 GB` style sizes for the log.
pub fn human(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut value = u128::from(bytes) * 10;
    let mut unit = 0;
    while value >= 10_000 && unit + 1 < UNITS.len() {
        value /= 1000;
        unit += 1;
    }
    format!("{}.{} {}", value / 10, value % 10, UNITS[unit])
}

fn append(path: &Path, line: &str) {
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(path)
    {
        let _ = file.write_all(line.as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_read_like_people_write_them() {
        assert_eq!(human(999), "999.0 B");
        assert_eq!(human(146_000_000), "146.0 MB");
        assert_eq!(human(3_220_000_000), "3.2 GB");
    }
}
