//! Locates the workspace root at runtime so data files resolve from any cwd.

use std::path::PathBuf;

/// Workspace root: every crate lives at `<root>/crates/<name>`.
pub fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

pub fn data() -> PathBuf {
    root().join("data")
}

pub fn config() -> PathBuf {
    root().join("config")
}
