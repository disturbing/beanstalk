//! The checked tree's manifest: every file's git object id, so a read map can say which content
//! each read file had, and a later tree can be compared with the one a map was traced on.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use super::ExtraFile;
use crate::error::Result;
use crate::git::{CommitSha, Repo};

/// The files of the checked tree with their blob ids.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TreeManifest {
    pub(crate) commit: CommitSha,
    /// Whether `extra_files` were written over the commit (the tree is then not the commit's).
    pub(crate) has_extra_files: bool,
    /// Path to blob id, the commit's files with the extra files' content over them.
    pub(crate) blobs: BTreeMap<String, String>,
}

impl TreeManifest {
    /// The blob ids of those of `paths` that are files of the tree.
    pub(crate) fn hashes_of<'a>(
        &self,
        paths: impl IntoIterator<Item = &'a String>,
    ) -> BTreeMap<String, String> {
        paths
            .into_iter()
            .filter_map(|path| {
                self.blobs
                    .get(path)
                    .map(|blob| (path.clone(), blob.clone()))
            })
            .collect()
    }
}

/// The manifest of `sha` as checked out in `checkout`, extra files included.
///
/// # Errors
///
/// Git failures listing the tree or hashing the extra files.
pub(crate) async fn manifest(
    repo: &Repo<'_>,
    sha: &CommitSha,
    checkout: &Path,
    extra_files: &[ExtraFile],
) -> Result<TreeManifest> {
    let mut blobs = repo.blob_ids(sha).await?;
    let written: Vec<PathBuf> = extra_files
        .iter()
        .map(|file| checkout.join(file.path()))
        .collect();
    let ids = repo.hash_files(&written).await?;
    for (file, id) in extra_files.iter().zip(ids) {
        blobs.insert(file.relative_path(), id);
    }
    Ok(TreeManifest {
        commit: sha.clone(),
        has_extra_files: !extra_files.is_empty(),
        blobs,
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

    use super::*;

    #[test]
    fn hashes_cover_only_files_of_the_tree() {
        let manifest = TreeManifest {
            commit: CommitSha::parse(&"a".repeat(40)).unwrap(),
            has_extra_files: false,
            blobs: BTreeMap::from([
                ("src/a.ts".to_owned(), "1".repeat(40)),
                ("src/b.ts".to_owned(), "2".repeat(40)),
            ]),
        };
        let reads = [
            "src/a.ts".to_owned(),
            "src".to_owned(),
            "gen/out.js".to_owned(),
        ];

        let hashes = manifest.hashes_of(&reads);

        assert_eq!(
            hashes,
            BTreeMap::from([("src/a.ts".to_owned(), "1".repeat(40))])
        );
    }
}
