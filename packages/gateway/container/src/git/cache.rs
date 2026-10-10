//! One bare repository per trunk remote under `WORK_DIR`, created on first use.
//!
//! Objects only ever arrive by named refs: the trunk's branches and candidate refs, and the ref a
//! change names on its fork. The runner never asks a remote for a bare SHA, because fetch-by-SHA
//! from Artifacts is unverified (plan §8).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, PoisonError};
use std::time::Duration;

use tokio::sync::Mutex;

use super::ids::{CommitSha, RefName};
use super::remote::{Remote, digest_hex};
use super::repo::Repo;
use super::{Git, GitOutput};
use crate::error::{Error, Result};

/// Pushes send whole objects (`pack.window=0`): Artifacts rejected a revert's push with "stored delta
/// chain contains a cycle" when git sent an old blob as a delta against a newer one that the server
/// already stored as a delta against the old (cloud race 2026-10-03). Whole objects cannot form a cycle.
const NO_DELTAS: &str = "0";

/// Trunk branches, mirrored into a local namespace.
const TRUNK_HEADS: &str = "+refs/heads/*:refs/beanstalk/trunk/heads/*";
/// Commits pushed by earlier steps, so any runner instance can fetch them by name.
const TRUNK_CANDIDATES: &str = "+refs/beanstalk/candidates/*:refs/beanstalk/trunk/candidates/*";
/// Where [`TRUNK_CANDIDATES`] puts candidates locally.
const TRUNK_CANDIDATES_LOCAL: &str = "refs/beanstalk/trunk/candidates/";
/// Pause before looking for a missing commit a second time (see [`TrunkCache::ensure_commits`]).
const REFETCH_DELAY: Duration = Duration::from_secs(2);
/// Local refs for fetched change refs, one per (remote, ref), named by digest so that names from
/// different forks never collide.
const FETCHED_PREFIX: &str = "refs/beanstalk/fetched/";
const FETCH_FLAGS: [&str; 3] = ["--quiet", "--no-tags", "--no-write-fetch-head"];
/// Settings of every cache; the harness configures its integration clone the same way.
const CACHE_CONFIG: [(&str, &str); 7] = [
    ("gc.auto", "0"),
    ("maintenance.auto", "false"),
    ("core.hooksPath", "/dev/null"),
    ("merge.conflictstyle", "merge"),
    ("core.autocrlf", "false"),
    ("rerere.enabled", "false"),
    ("commit.gpgsign", "false"),
];

type CacheLock = Arc<Mutex<()>>;

/// The caches under one root, with one lock per cache that serialises fetches (which move local
/// refs). Merges and commits only add objects and run concurrently.
#[derive(Debug)]
pub(crate) struct RepoCaches {
    root: PathBuf,
    locks: std::sync::Mutex<HashMap<String, CacheLock>>,
}

impl RepoCaches {
    pub(crate) fn new(root: PathBuf) -> Self {
        Self {
            root,
            locks: std::sync::Mutex::default(),
        }
    }

    /// The cache for `trunk`, created if this is its first use.
    ///
    /// # Errors
    ///
    /// [`Error::Git`] or [`Error::Io`] when the bare repository cannot be created.
    pub(crate) async fn open<'a>(&self, git: &'a Git, trunk: &'a Remote) -> Result<TrunkCache<'a>> {
        let key = trunk.url.cache_key();
        let cache = TrunkCache {
            repo: Repo::new(git, self.root.join(format!("{key}.git"))),
            trunk,
            lock: self.lock_for(&key),
        };
        cache
            .create_if_missing(&self.root.join(format!("{key}.init")))
            .await?;
        Ok(cache)
    }

    fn lock_for(&self, key: &str) -> CacheLock {
        let mut locks = self.locks.lock().unwrap_or_else(PoisonError::into_inner);
        Arc::clone(locks.entry(key.to_owned()).or_default())
    }
}

/// The bare cache of one trunk remote.
#[derive(Debug)]
pub(crate) struct TrunkCache<'a> {
    repo: Repo<'a>,
    trunk: &'a Remote,
    lock: CacheLock,
}

impl<'a> TrunkCache<'a> {
    pub(crate) fn repo(&self) -> &Repo<'a> {
        &self.repo
    }

    /// Makes sure every commit is present, fetching from the trunk if any is not: first each
    /// missing commit's candidate ref, then (only if one is still missing) every branch and
    /// candidate. A commit still missing is looked for once more after [`REFETCH_DELAY`]: it is
    /// usually a candidate pushed moments earlier by another instance, and the remote is
    /// eventually consistent.
    ///
    /// # Errors
    ///
    /// [`Error::UnknownCommit`] when a commit is not reachable from the trunk's branches or
    /// candidate refs; [`Error::Remote`] when a fetch fails.
    pub(crate) async fn ensure_commits(&self, shas: &[&CommitSha]) -> Result<()> {
        self.ensure_commits_pausing(shas, tokio::time::sleep(REFETCH_DELAY))
            .await
    }

    /// [`Self::ensure_commits`] with the pause before the second look given (tests make the
    /// commit appear there).
    async fn ensure_commits_pausing(
        &self,
        shas: &[&CommitSha],
        pause: impl Future<Output = ()>,
    ) -> Result<()> {
        if self.first_missing(shas).await?.is_none() || self.fetch_missing(shas).await?.is_none() {
            return Ok(());
        }
        pause.await;
        match self.fetch_missing(shas).await? {
            None => Ok(()),
            Some(sha) => Err(Error::UnknownCommit {
                sha: sha.to_string(),
                repo: self.trunk.url.to_string(),
            }),
        }
    }

    /// Fetches `reference` from `source` (a task's fork) and returns the commit it names now.
    ///
    /// # Errors
    ///
    /// [`Error::UnknownRef`] when the remote has no such ref; [`Error::Remote`] when the fetch
    /// fails otherwise.
    pub(crate) async fn fetch_change(
        &self,
        source: &Remote,
        reference: &RefName,
    ) -> Result<CommitSha> {
        let local = format!(
            "{FETCHED_PREFIX}{}",
            digest_hex(&[source.url.as_str(), reference.as_str()])
        );
        let unknown_ref = || Error::UnknownRef {
            reference: reference.to_string(),
            repo: source.url.to_string(),
        };
        let _fetching = self.lock.lock().await;
        let output = self
            .repo
            .command("fetch")
            .remote(source)
            .args(FETCH_FLAGS)
            .arg(source.url.as_str())
            .arg(format!("+{reference}:{local}"))
            .output()
            .await?;
        if output.stderr().contains("couldn't find remote ref") {
            return Err(unknown_ref());
        }
        if !output.succeeded() {
            return Err(output.failure());
        }
        self.repo
            .resolve_commit(&local)
            .await?
            .ok_or_else(unknown_ref)
    }

    /// Publishes each commit as `refs/beanstalk/candidates/<sha>` on the trunk.
    ///
    /// # Errors
    ///
    /// [`Error::Remote`] when the push fails.
    pub(crate) async fn push_candidates(&self, shas: &[&CommitSha]) -> Result<()> {
        if shas.is_empty() {
            return Ok(());
        }
        let refspecs = shas
            .iter()
            .map(|sha| format!("{sha}:{}", RefName::candidate(sha)));
        let output = self
            .repo
            .command("push")
            .remote(self.trunk)
            .config("pack.window", NO_DELTAS)
            .arg("--porcelain")
            .arg(self.trunk.url.as_str())
            .args(refspecs)
            .output()
            .await?;
        if output.succeeded() || self.candidates_published(shas).await? {
            return Ok(());
        }
        Err(output.failure())
    }

    /// Whether each candidate ref on the trunk already names its commit. A candidate's name
    /// carries its sha, so a concurrent request that built the identical commit (same tree,
    /// parent, message and second) can create the ref first; the result is the one wanted.
    async fn candidates_published(&self, shas: &[&CommitSha]) -> Result<bool> {
        let names: Vec<RefName> = shas.iter().map(|sha| RefName::candidate(sha)).collect();
        let listing = self
            .repo
            .command("ls-remote")
            .remote(self.trunk)
            .arg(self.trunk.url.as_str())
            .args(names.iter().map(RefName::as_str))
            .success()
            .await?
            .stdout();
        Ok(shas
            .iter()
            .zip(&names)
            .all(|(sha, name)| parse_ls_remote(&listing, name).as_ref() == Some(*sha)))
    }

    /// Points a trunk ref at a commit, guarded by a lease (`git push --force-with-lease`; the
    /// server re-checks the old value under its ref lock).
    ///
    /// # Errors
    ///
    /// [`Error::UnknownCommit`] when the new commit cannot be found; [`Error::Remote`] when the
    /// push fails for a reason other than a stale lease.
    pub(crate) async fn update_ref(&self, update: &RefUpdate) -> Result<RefUpdateOutcome> {
        self.ensure_commits(&[&update.new]).await?;
        let output = self
            .repo
            .command("push")
            .remote(self.trunk)
            .config("pack.window", NO_DELTAS)
            .arg("--porcelain")
            .arg(update.lease.push_flag(&update.reference))
            .arg(self.trunk.url.as_str())
            .arg(format!("{}:{}", update.new, update.reference))
            .output()
            .await?;
        if output.succeeded() {
            return Ok(RefUpdateOutcome::Updated);
        }
        if !was_rejected(&output, &update.reference) {
            return Err(output.failure());
        }
        let actual = self.remote_ref(&update.reference).await?;
        if update.lease.is_held_by(actual.as_ref()) {
            // The lease held, so the remote refused for another reason (permissions, hooks).
            return Err(output.failure());
        }
        Ok(RefUpdateOutcome::Stale { actual })
    }

    async fn create_if_missing(&self, staging: &Path) -> Result<()> {
        if self.is_created().await {
            return Ok(());
        }
        let _creating = self.lock.lock().await;
        if self.is_created().await {
            return Ok(());
        }
        // Built aside and renamed into place, so a crash never leaves a half-made cache.
        remove_dir_if_present(staging).await?;
        let git = self.repo.git();
        let parent = staging.parent().unwrap_or(staging);
        git.command(parent, "init")
            .args(["--bare", "--quiet"])
            .arg(staging)
            .success()
            .await?;
        for (key, value) in CACHE_CONFIG {
            git.command(staging, "config")
                .args([key, value])
                .success()
                .await?;
        }
        tokio::fs::rename(staging, self.repo.dir())
            .await
            .map_err(Error::io(format!(
                "moving {} into place",
                staging.display()
            )))
    }

    async fn is_created(&self) -> bool {
        tokio::fs::try_exists(self.repo.dir().join("HEAD"))
            .await
            .unwrap_or(false)
    }

    async fn first_missing<'s>(&self, shas: &[&'s CommitSha]) -> Result<Option<&'s CommitSha>> {
        for sha in shas {
            if !self.repo.has_commit(sha).await? {
                return Ok(Some(sha));
            }
        }
        Ok(None)
    }

    /// Under the fetch lock: fetches what is missing and returns the first commit still missing.
    async fn fetch_missing<'s>(&self, shas: &[&'s CommitSha]) -> Result<Option<&'s CommitSha>> {
        let _fetching = self.lock.lock().await;
        let mut missing = Vec::new();
        for sha in shas {
            if !self.repo.has_commit(sha).await? {
                missing.push(*sha);
            }
        }
        if missing.is_empty() {
            return Ok(None);
        }
        self.fetch_candidates(&missing).await?;
        if self.first_missing(&missing).await?.is_none() {
            return Ok(None);
        }
        self.fetch_trunk().await?;
        self.first_missing(&missing).await
    }

    /// Fetches the candidate refs named after `shas`. Each refspec is a pattern (`<sha>*`) so that
    /// a candidate the trunk does not have matches nothing instead of failing the fetch; the
    /// remote filters by the pattern's prefix, so only those refs are listed.
    async fn fetch_candidates(&self, shas: &[&CommitSha]) -> Result<GitOutput> {
        let refspecs = shas.iter().map(|sha| {
            format!(
                "+{}*:{TRUNK_CANDIDATES_LOCAL}{sha}*",
                RefName::candidate(sha)
            )
        });
        self.repo
            .command("fetch")
            .remote(self.trunk)
            .args(FETCH_FLAGS)
            .arg(self.trunk.url.as_str())
            .args(refspecs)
            .success()
            .await
    }

    /// Mirrors every trunk branch and candidate: the fallback for a commit that is not a
    /// candidate (a trunk head set elsewhere). Every agent's branch comes too, so it runs only when
    /// the candidate fetch did not find the commit.
    async fn fetch_trunk(&self) -> Result<GitOutput> {
        self.repo
            .command("fetch")
            .remote(self.trunk)
            .args(FETCH_FLAGS)
            .arg("--prune")
            .arg(self.trunk.url.as_str())
            .args([TRUNK_HEADS, TRUNK_CANDIDATES])
            .success()
            .await
    }

    async fn remote_ref(&self, reference: &RefName) -> Result<Option<CommitSha>> {
        let output = self
            .repo
            .command("ls-remote")
            .remote(self.trunk)
            .arg(self.trunk.url.as_str())
            .arg(reference.as_str())
            .success()
            .await?;
        Ok(parse_ls_remote(&output.stdout(), reference))
    }
}

async fn remove_dir_if_present(path: &Path) -> Result<()> {
    match tokio::fs::remove_dir_all(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(Error::io(format!("removing {}", path.display()))(error)),
    }
}

/// Whether `git push --porcelain` reported the ref as rejected (`!` flag).
fn was_rejected(output: &GitOutput, reference: &RefName) -> bool {
    let target = format!(":{reference}\t");
    output
        .stdout()
        .lines()
        .any(|line| line.starts_with('!') && line.contains(&target))
}

/// The commit `reference` points at in `git ls-remote` output (exact name match).
fn parse_ls_remote(stdout: &str, reference: &RefName) -> Option<CommitSha> {
    stdout.lines().find_map(|line| {
        let (sha, name) = line.split_once('\t')?;
        (name == reference.as_str())
            .then(|| CommitSha::parse(sha).ok())
            .flatten()
    })
}

/// The condition under which a trunk ref may move.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Lease {
    /// Move unconditionally (the harness's `update_ref` without `old`).
    Any,
    /// Create the ref; fail if it exists.
    Absent,
    /// Move only from this commit.
    At(CommitSha),
}

impl Lease {
    fn push_flag(&self, reference: &RefName) -> String {
        match self {
            Self::Any => "--force".to_owned(),
            Self::Absent => format!("--force-with-lease={reference}:"),
            Self::At(old) => format!("--force-with-lease={reference}:{old}"),
        }
    }

    fn is_held_by(&self, actual: Option<&CommitSha>) -> bool {
        match self {
            Self::Any => true,
            Self::Absent => actual.is_none(),
            Self::At(old) => actual == Some(old),
        }
    }
}

/// A requested move of a trunk ref.
#[derive(Debug, Clone)]
pub(crate) struct RefUpdate {
    pub(crate) reference: RefName,
    pub(crate) new: CommitSha,
    pub(crate) lease: Lease,
}

/// What happened to a requested ref move.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RefUpdateOutcome {
    Updated,
    /// The lease did not hold; `actual` is the ref's value on the remote (`None`: absent).
    Stale {
        actual: Option<CommitSha>,
    },
}

#[cfg(test)]
#[path = "cache_tests.rs"]
mod fetch_tests;

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

    use super::*;

    fn sha(fill: char) -> CommitSha {
        CommitSha::parse(&fill.to_string().repeat(40)).unwrap()
    }

    #[test]
    fn ls_remote_matches_the_exact_ref_only() {
        let trunk = RefName::parse("refs/heads/trunk").unwrap();
        let stdout = format!(
            "{}\trefs/heads/x/refs/heads/trunk\n{}\trefs/heads/trunk\n",
            "a".repeat(40),
            "b".repeat(40)
        );

        assert_eq!(parse_ls_remote(&stdout, &trunk), Some(sha('b')));
        assert_eq!(parse_ls_remote("", &trunk), None);
    }

    #[test]
    fn leases_render_as_push_flags() {
        let trunk = RefName::parse("refs/heads/trunk").unwrap();

        assert_eq!(Lease::Any.push_flag(&trunk), "--force");
        assert_eq!(
            Lease::Absent.push_flag(&trunk),
            "--force-with-lease=refs/heads/trunk:"
        );
        assert_eq!(
            Lease::At(sha('c')).push_flag(&trunk),
            format!("--force-with-lease=refs/heads/trunk:{}", "c".repeat(40))
        );
    }

    #[test]
    fn a_lease_holds_only_for_its_expected_value() {
        assert!(Lease::At(sha('a')).is_held_by(Some(&sha('a'))));
        assert!(!Lease::At(sha('a')).is_held_by(Some(&sha('b'))));
        assert!(!Lease::At(sha('a')).is_held_by(None));
        assert!(Lease::Absent.is_held_by(None));
        assert!(!Lease::Absent.is_held_by(Some(&sha('a'))));
    }
}
