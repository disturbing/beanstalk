//! How a cache finds commits: the candidate ref first, the trunk mirror as a fallback, and one more
//! look after a pause for a candidate the remote did not show yet. Remotes are local bare
//! repositories holding the arena bundle's commits.

#![allow(clippy::unwrap_used, clippy::expect_used)] // tests fail loudly by design

use std::path::{Path, PathBuf};
use std::process::Command;

use tempfile::TempDir;

use super::*;
use crate::config::Config;
use crate::git::{Git, RemoteUrl, Token};
use crate::process::ChildEnv;

const ARENA_BUNDLE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/arena.bundle");
/// `ref/t001` in the bundle: a child of `main` that the trunk does not hold at first.
const T001: &str = "950519101064423a88589f45952826f75b9e90cc";

/// A trunk remote holding the arena's `main`, plus a source holding every task's commit.
struct Fixture {
    root: TempDir,
    git: Git,
    trunk: Remote,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let trunk_dir = bare(&root.path().join("trunk.git"));
        git(
            &trunk_dir,
            &[
                "fetch",
                "--quiet",
                ARENA_BUNDLE,
                "refs/heads/main:refs/heads/main",
            ],
        );
        let config =
            Config::from_lookup(|name| (name == "REMOTE_SCHEMES").then(|| "file".to_owned()))
                .unwrap();
        let trunk = Remote {
            url: RemoteUrl::parse(
                &format!("file://{}", trunk_dir.display()),
                config.remote_schemes(),
            )
            .unwrap(),
            token: Token::try_from("local".to_owned()).unwrap(),
        };
        Self {
            git: Git::new(&ChildEnv::inherit(), config.identity()),
            root,
            trunk,
        }
    }

    fn trunk_dir(&self) -> PathBuf {
        self.root.path().join("trunk.git")
    }

    /// Puts t001's commit on the trunk under `reference`.
    fn publish_t001(&self, reference: &str) {
        git(
            &self.trunk_dir(),
            &[
                "fetch",
                "--quiet",
                ARENA_BUNDLE,
                &format!("refs/heads/ref/t001:{reference}"),
            ],
        );
    }

    fn caches(&self) -> RepoCaches {
        let work = self.root.path().join("work");
        std::fs::create_dir_all(&work).unwrap();
        RepoCaches::new(work)
    }

    fn cache_refs(&self) -> String {
        let caches = self.root.path().join("work");
        let cache = std::fs::read_dir(&caches)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| path.extension().is_some_and(|ext| ext == "git"))
            .unwrap();
        git(&cache, &["for-each-ref", "--format=%(refname)"])
    }
}

fn bare(dir: &Path) -> PathBuf {
    std::fs::create_dir_all(dir).unwrap();
    git(dir, &["init", "--bare", "--quiet"]);
    dir.to_path_buf()
}

fn git(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

fn t001() -> CommitSha {
    CommitSha::parse(T001).unwrap()
}

#[tokio::test]
async fn a_candidate_is_fetched_by_its_own_ref_without_mirroring_the_trunk() {
    let fixture = Fixture::new();
    let sha = t001();
    fixture.publish_t001(RefName::candidate(&sha).as_str());
    let caches = fixture.caches();
    let cache = caches.open(&fixture.git, &fixture.trunk).await.unwrap();

    cache
        .ensure_commits_pausing(&[&sha], async {})
        .await
        .unwrap();

    let refs = fixture.cache_refs();
    assert!(
        refs.contains(&format!("{TRUNK_CANDIDATES_LOCAL}{T001}")),
        "{refs}"
    );
    assert!(!refs.contains("refs/beanstalk/trunk/heads/"), "{refs}");
}

#[tokio::test]
async fn a_commit_on_a_trunk_branch_only_is_found_by_the_mirror() {
    let fixture = Fixture::new();
    fixture.publish_t001("refs/heads/sprout");
    let caches = fixture.caches();
    let cache = caches.open(&fixture.git, &fixture.trunk).await.unwrap();

    cache
        .ensure_commits_pausing(&[&t001()], async {})
        .await
        .unwrap();

    assert!(
        fixture
            .cache_refs()
            .contains("refs/beanstalk/trunk/heads/sprout")
    );
}

#[tokio::test]
async fn a_candidate_that_appears_after_the_first_fetch_is_found_on_the_second_look() {
    let fixture = Fixture::new();
    let sha = t001();
    let caches = fixture.caches();
    let cache = caches.open(&fixture.git, &fixture.trunk).await.unwrap();
    // The pause is where the eventually consistent remote catches up.
    let catch_up = async { fixture.publish_t001(RefName::candidate(&sha).as_str()) };

    let found = cache.ensure_commits_pausing(&[&sha], catch_up).await;

    assert!(found.is_ok(), "{found:?}");
}

#[tokio::test]
async fn a_commit_missing_after_the_second_look_is_unknown() {
    let fixture = Fixture::new();
    let caches = fixture.caches();
    let cache = caches.open(&fixture.git, &fixture.trunk).await.unwrap();

    let found = cache.ensure_commits_pausing(&[&t001()], async {}).await;

    assert!(
        matches!(&found, Err(Error::UnknownCommit { sha, .. }) if sha == T001),
        "{found:?}"
    );
}
