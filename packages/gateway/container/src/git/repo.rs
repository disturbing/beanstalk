//! Local operations on a bare repository: the parts of the harness's `gitops.py` that need no
//! network, with the same arguments and output handling.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use super::ids::{CommitSha, TreeId};
use super::rules::MergeSetup;
use super::{Git, GitCommand, GitOutput};
use crate::error::{Error, Result};

/// A bare repository and the git that operates on it.
#[derive(Debug)]
pub(crate) struct Repo<'a> {
    git: &'a Git,
    dir: PathBuf,
}

/// The three commits of a 3-way merge.
#[derive(Debug, Clone, Copy)]
pub(crate) struct ThreeWay<'a> {
    pub(crate) base: &'a CommitSha,
    pub(crate) ours: &'a CommitSha,
    pub(crate) theirs: &'a CommitSha,
}

/// The result of a merge without a worktree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TreeMerge {
    Clean(TreeId),
    /// `tree` holds the conflicted files with conflict markers; `files` are the conflicted
    /// paths, sorted and unique.
    Conflicted {
        tree: TreeId,
        files: Vec<String>,
    },
}

impl<'a> Repo<'a> {
    pub(crate) fn new(git: &'a Git, dir: PathBuf) -> Self {
        Self { git, dir }
    }

    pub(crate) fn dir(&self) -> &Path {
        &self.dir
    }

    pub(crate) fn git(&self) -> &'a Git {
        self.git
    }

    pub(crate) fn command(&self, subcommand: &'static str) -> GitCommand<'_> {
        self.git.command(&self.dir, subcommand)
    }

    /// Whether `sha` names a commit in this repository.
    pub(crate) async fn has_commit(&self, sha: &CommitSha) -> Result<bool> {
        let output = self
            .command("cat-file")
            .arg("-e")
            .arg(format!("{sha}^{{commit}}"))
            .output()
            .await?;
        Ok(output.succeeded())
    }

    /// The commit `name` resolves to, if it resolves to one.
    pub(crate) async fn resolve_commit(&self, name: &str) -> Result<Option<CommitSha>> {
        let output = self
            .command("rev-parse")
            .args(["--verify", "--quiet"])
            .arg(format!("{name}^{{commit}}"))
            .output()
            .await?;
        if !output.succeeded() {
            return Ok(None);
        }
        parse_commit_line(&output).map(Some)
    }

    /// The first parent of `sha`, or `None` for a root commit.
    pub(crate) async fn first_parent(&self, sha: &CommitSha) -> Result<Option<CommitSha>> {
        self.resolve_commit(&format!("{sha}^1")).await
    }

    /// `git merge-base <left> <right>`. Argument order follows the harness: with several best
    /// common ancestors (criss-cross history) git picks one, and the order can change which.
    pub(crate) async fn merge_base(
        &self,
        left: &CommitSha,
        right: &CommitSha,
    ) -> Result<CommitSha> {
        let output = self
            .command("merge-base")
            .arg(left.as_str())
            .arg(right.as_str())
            .output()
            .await?;
        match output.code() {
            Some(0) => parse_commit_line(&output),
            Some(1) => Err(Error::NoMergeBase {
                left: left.to_string(),
                right: right.to_string(),
            }),
            _ => Err(output.failure()),
        }
    }

    /// A 3-way merge without a worktree (`gitops.merge_tree`): `git merge-tree --write-tree
    /// --name-only --no-messages --merge-base=<base> <ours> <theirs>`, with `-z` so unusual path
    /// names come back unquoted.
    pub(crate) async fn merge_tree(
        &self,
        three_way: ThreeWay<'_>,
        setup: &MergeSetup,
    ) -> Result<TreeMerge> {
        let output = setup
            .apply(self.command("merge-tree"))
            .args(["--write-tree", "--name-only", "--no-messages", "-z"])
            .arg(format!("--merge-base={}", three_way.base))
            .arg(three_way.ours.as_str())
            .arg(three_way.theirs.as_str())
            .output()
            .await?;
        parse_merge_tree(&output)
    }

    /// The text of `path` in `tree`, or `None` when the tree has no such file.
    pub(crate) async fn read_file(&self, tree: &TreeId, path: &str) -> Result<Option<String>> {
        let output = self
            .command("cat-file")
            .arg("blob")
            .arg(format!("{}:{path}", tree.as_str()))
            .output()
            .await?;
        Ok(output.succeeded().then(|| output.stdout()))
    }

    /// `git commit-tree <tree> -p <parent>` with `message` on stdin (`gitops.commit_tree`).
    pub(crate) async fn commit_tree(
        &self,
        tree: &TreeId,
        parent: &CommitSha,
        message: &str,
    ) -> Result<CommitSha> {
        let output = self
            .command("commit-tree")
            .arg(tree.as_str())
            .arg("-p")
            .arg(parent.as_str())
            .stdin(message.as_bytes())
            .success()
            .await?;
        parse_commit_line(&output)
    }

    /// Paths changed between two commits, renames reported as both paths (`gitops.changed_files`).
    pub(crate) async fn changed_files(
        &self,
        from: &CommitSha,
        to: &CommitSha,
    ) -> Result<Vec<String>> {
        let output = self
            .command("diff")
            .args(["--name-status", "--no-renames", "-z"])
            .arg(from.as_str())
            .arg(to.as_str())
            .success()
            .await?;
        Ok(parse_name_status(&output.stdout()))
    }

    /// Every file of `sha`'s tree with its object id (`git ls-tree -r -z --full-tree`);
    /// submodules, which have no blob, are left out.
    pub(crate) async fn blob_ids(&self, sha: &CommitSha) -> Result<BTreeMap<String, String>> {
        let output = self
            .command("ls-tree")
            .args(["-r", "-z", "--full-tree"])
            .arg(sha.as_str())
            .success()
            .await?;
        Ok(parse_ls_tree(&output.stdout()))
    }

    /// The object ids `files` would have as blobs here, unfiltered (`git hash-object
    /// --no-filters --stdin-paths`), in order.
    pub(crate) async fn hash_files(&self, files: &[PathBuf]) -> Result<Vec<String>> {
        if files.is_empty() {
            return Ok(Vec::new());
        }
        let mut list = String::new();
        for file in files {
            list.push_str(&file.to_string_lossy());
            list.push('\n');
        }
        let output = self
            .command("hash-object")
            .args(["--no-filters", "--stdin-paths"])
            .stdin(list.as_bytes())
            .success()
            .await?;
        Ok(output.stdout().lines().map(str::to_owned).collect())
    }

    /// Writes the files of `sha` into `dest` through a throwaway index, leaving no worktree
    /// bookkeeping in the cache. Equivalent to the harness's `checkout -f --detach` plus
    /// `clean -fdx` in a CI slot.
    pub(crate) async fn checkout(&self, sha: &CommitSha, index: &Path, dest: &Path) -> Result<()> {
        self.command("read-tree")
            .env("GIT_DIR", &self.dir)
            .env("GIT_INDEX_FILE", index)
            .env("GIT_WORK_TREE", dest)
            .args(["--reset", "-u"])
            .arg(sha.as_str())
            .success()
            .await?;
        Ok(())
    }
}

fn parse_commit_line(output: &GitOutput) -> Result<CommitSha> {
    let stdout = output.stdout();
    let line = stdout.lines().next().unwrap_or_default().trim();
    CommitSha::parse(line).map_err(|reason| Error::Git {
        op: "rev-parse",
        detail: reason,
    })
}

/// Exit 0 with a tree is clean, exit 1 with a tree is a conflict; anything else is an error, as in
/// the harness.
fn parse_merge_tree(output: &GitOutput) -> Result<TreeMerge> {
    let stdout = output.stdout();
    let mut fields = stdout.split('\0');
    let tree = fields.next().map(str::trim).filter(|tree| !tree.is_empty());
    let parse_tree = |tree: &str| {
        TreeId::parse(tree).map_err(|reason| Error::Git {
            op: "merge-tree",
            detail: reason,
        })
    };
    match (output.code(), tree) {
        (Some(0), Some(tree)) => parse_tree(tree).map(TreeMerge::Clean),
        (Some(1), Some(tree)) => {
            let paths: BTreeSet<&str> = fields.filter(|path| !path.is_empty()).collect();
            Ok(TreeMerge::Conflicted {
                tree: parse_tree(tree)?,
                files: paths.into_iter().map(str::to_owned).collect(),
            })
        }
        _ => Err(output.failure()),
    }
}

/// `git diff --name-status -z` output as a sorted set of paths, parsed as `gitops.changed_files`
/// does (a rename or copy entry carries two paths).
#[must_use]
pub(crate) fn parse_name_status(stdout: &str) -> Vec<String> {
    let parts: Vec<&str> = stdout.split('\0').filter(|part| !part.is_empty()).collect();
    let mut paths: BTreeSet<&str> = BTreeSet::new();
    let mut index = 0;
    while let Some(status) = parts.get(index) {
        let has_two_paths = status.starts_with(['R', 'C']) && index + 2 < parts.len();
        let width = if has_two_paths { 2 } else { 1 };
        paths.extend(parts.iter().skip(index + 1).take(width).copied());
        index += width + 1;
    }
    paths.into_iter().map(str::to_owned).collect()
}

/// `git ls-tree -r -z` output (`<mode> <type> <id>\t<path>\0` per entry) as path to blob id.
#[must_use]
pub(crate) fn parse_ls_tree(stdout: &str) -> BTreeMap<String, String> {
    stdout
        .split('\0')
        .filter_map(|entry| {
            let (meta, path) = entry.split_once('\t')?;
            let mut fields = meta.split(' ');
            let (_mode, kind, id) = (fields.next()?, fields.next()?, fields.next()?);
            (kind == "blob").then(|| (path.to_owned(), id.to_owned()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use proptest::prelude::*;

    use super::*;

    #[test]
    fn ls_tree_keeps_blobs_and_paths_exactly() {
        let stdout = "100644 blob aaa\tsrc/a b.ts\x00160000 commit bbb\tvendor/sub\0\
                      120000 blob ccc\tlink\0";

        let blobs = parse_ls_tree(stdout);

        assert_eq!(blobs.get("src/a b.ts").map(String::as_str), Some("aaa"));
        assert_eq!(blobs.get("link").map(String::as_str), Some("ccc"));
        assert!(!blobs.contains_key("vendor/sub"));
    }

    #[test]
    fn name_status_reports_both_sides_of_a_rename() {
        let stdout = "M\0src/a.ts\0R100\0old.ts\0new.ts\0D\0gone.ts\0";

        assert_eq!(
            parse_name_status(stdout),
            vec!["gone.ts", "new.ts", "old.ts", "src/a.ts"]
        );
    }

    #[test]
    fn name_status_of_no_change_is_empty() {
        assert!(parse_name_status("").is_empty());
    }

    proptest! {
        #[test]
        fn name_status_yields_each_path_once_in_order(
            entries in proptest::collection::vec(
                ("[MADT]", "[a-z]{1,3}(/[a-z]{1,3}){0,2}"), 0..12),
        ) {
            let stdout = entries
                .iter()
                .map(|(status, path)| format!("{status}\0{path}\0"))
                .collect::<Vec<_>>()
                .concat();
            let expected: BTreeSet<String> = entries.iter().map(|(_, path)| path.clone()).collect();

            let paths = parse_name_status(&stdout);

            prop_assert_eq!(paths, expected.into_iter().collect::<Vec<_>>());
        }
    }
}
