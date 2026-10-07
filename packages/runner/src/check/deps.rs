//! Dependency snapshots baked into the image (`$DEPS_DIR/<name>/node_modules`, installed from an
//! arena's lockfile at build time). A check that names one gets it linked as `node_modules` one
//! level above its checkout, where Node's resolution finds it, as the harness links the arena's
//! snapshot above every worktree. Nothing is installed at check time, so the suite runs offline
//! and check time never includes an install.

use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

/// A snapshot's directory name: lower-case letters, digits, `.`, `_` and `-`, starting with a
/// letter or digit, so it can never climb out of `DEPS_DIR`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DepsName(String);

impl DepsName {
    /// # Errors
    ///
    /// A reason when `name` is not a plain directory name.
    pub(crate) fn parse(name: &str) -> Result<Self, String> {
        let mut chars = name.chars();
        let starts_well = chars
            .next()
            .is_some_and(|first| first.is_ascii_lowercase() || first.is_ascii_digit());
        let rest_ok =
            chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "._-".contains(c));
        if starts_well && rest_ok && name.len() <= 64 {
            Ok(Self(name.to_owned()))
        } else {
            Err(format!("{name:?} is not a dependency snapshot name"))
        }
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

/// The snapshot's `node_modules`.
///
/// # Errors
///
/// [`Error::InvalidRequest`] when the image has no snapshot of that name.
pub(crate) async fn node_modules(deps_dir: &Path, name: &DepsName) -> Result<PathBuf> {
    let path = deps_dir.join(name.as_str()).join("node_modules");
    match tokio::fs::metadata(&path).await {
        Ok(meta) if meta.is_dir() => Ok(path),
        _ => Err(Error::InvalidRequest(format!(
            "deps: this runner image has no dependency snapshot {:?}",
            name.as_str()
        ))),
    }
}

/// Links `node_modules` into `job_dir` (the checkout's parent).
///
/// # Errors
///
/// [`Error::Io`] when the link cannot be made.
pub(crate) async fn link_above(job_dir: &Path, node_modules: &Path) -> Result<()> {
    let link = job_dir.join("node_modules");
    tokio::fs::symlink(node_modules, &link)
        .await
        .map_err(Error::io(format!("linking {}", link.display())))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

    use super::*;

    #[test]
    fn names_are_plain_directory_names() {
        assert!(DepsName::parse("fastify").is_ok());
        assert!(DepsName::parse("fastify-5.6.1_a").is_ok());
        for bad in [
            "",
            "..",
            "../etc",
            "a/b",
            "Fastify",
            ".hidden",
            "-x",
            &"a".repeat(65),
        ] {
            assert!(DepsName::parse(bad).is_err(), "{bad:?}");
        }
    }

    #[tokio::test]
    async fn resolves_a_snapshot_and_refuses_a_missing_one() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("fastify/node_modules")).unwrap();

        let found = node_modules(root.path(), &DepsName::parse("fastify").unwrap()).await;
        let missing = node_modules(root.path(), &DepsName::parse("express").unwrap()).await;

        assert_eq!(found.unwrap(), root.path().join("fastify/node_modules"));
        assert!(missing.unwrap_err().to_string().contains("deps:"));
    }
}
