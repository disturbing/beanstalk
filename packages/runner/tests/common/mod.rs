//! Shared fixtures: local bare repositories stand in for Artifacts remotes (file:// URLs), and the
//! runner's router is driven in-process.

// Each test crate uses a different subset of these helpers.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Command;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use runner::app::{self, AppState};
use runner::config::Config;
use serde_json::Value;
use tempfile::TempDir;
use tower::ServiceExt;

/// A token in Artifacts' format; tests check it never comes back in a response.
pub const TOKEN: &str = "art_v1_0123456789abcdef0123456789abcdef01234567?expires=1999999999";

/// The arena materialized by `research/arena/materialize.py`: `main` plus four tasks' reference
/// commits (`ref/t001`, `ref/t002`, `ref/t005`, `ref/t040`), each a child of `main`.
pub const ARENA_BUNDLE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/arena.bundle");
pub const ARENA_BASE: &str = "26eecce0d764943d0c89a6139e3491055e9ff00c";

/// Runs git with an isolated environment and returns its trimmed stdout; panics on failure.
pub fn git(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_AUTHOR_NAME", "fixture")
        .env("GIT_AUTHOR_EMAIL", "fixture@beanstalk.invalid")
        .env("GIT_COMMITTER_NAME", "fixture")
        .env("GIT_COMMITTER_EMAIL", "fixture@beanstalk.invalid")
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .expect("utf-8")
        .trim()
        .to_owned()
}

/// Whether `node` (25 or later) is on PATH; tests that run suites skip without it.
pub fn has_node() -> bool {
    let available = Command::new("node")
        .arg("--version")
        .output()
        .is_ok_and(|output| output.status.success());
    if !available {
        // Visible with `cargo test -- --nocapture`; the check tests pass vacuously without node.
        #[allow(clippy::print_stderr)] // the only way to say why a test did nothing
        {
            eprintln!("node not found on PATH: skipping test-suite checks");
        }
    }
    available
}

/// A temporary directory holding the runner's `WORK_DIR` and the stand-in remotes.
pub struct World {
    root: TempDir,
    router: Router,
}

impl World {
    /// A runner that accepts https and file remotes.
    pub async fn new() -> Self {
        Self::with_schemes("https,file").await
    }

    /// A runner configured as in production: https remotes only.
    pub async fn https_only() -> Self {
        Self::with_schemes("https").await
    }

    async fn with_schemes(schemes: &str) -> Self {
        let root = tempfile::tempdir().expect("temp dir");
        let router = runner_router(&root.path().join("work"), schemes).await;
        Self { root, router }
    }

    /// Another runner instance (its own `WORK_DIR`) over the same remotes, like a second
    /// container in the pool.
    pub async fn second_runner(&self) -> Router {
        runner_router(&self.root.path().join("work-2"), "https,file").await
    }

    /// A new, empty bare repository.
    pub fn bare(&self, name: &str) -> Remote {
        let dir = self.root.path().join("remotes").join(format!("{name}.git"));
        std::fs::create_dir_all(&dir).expect("remote dir");
        git(&dir, &["init", "--bare", "--quiet"]);
        Remote { dir }
    }

    /// A bare repository holding the arena bundle's branches.
    pub fn arena(&self, name: &str) -> Remote {
        let remote = self.bare(name);
        git(
            &remote.dir,
            &[
                "fetch",
                "--quiet",
                ARENA_BUNDLE,
                "refs/heads/*:refs/heads/*",
            ],
        );
        remote
    }

    /// A working repository for building commits.
    pub fn work(&self, name: &str) -> Work {
        let dir = self.root.path().join("work-trees").join(name);
        std::fs::create_dir_all(&dir).expect("work dir");
        git(&dir, &["init", "--quiet", "-b", "main"]);
        Work { dir }
    }

    pub async fn post(&self, path: &str, body: &Value) -> (StatusCode, Value) {
        post(&self.router, path, body).await
    }

    pub async fn get(&self, path: &str) -> (StatusCode, Value) {
        send(
            &self.router,
            Request::get(path).body(Body::empty()).expect("request"),
        )
        .await
    }
}

async fn runner_router(work_dir: &Path, schemes: &str) -> Router {
    let work_dir = work_dir.to_string_lossy().into_owned();
    let schemes = schemes.to_owned();
    let config = Config::from_lookup(|name| match name {
        "WORK_DIR" => Some(work_dir.clone()),
        "REMOTE_SCHEMES" => Some(schemes.clone()),
        _ => None,
    })
    .expect("config");
    app::router(AppState::prepare(&config).await.expect("state"))
}

/// Sends a JSON POST through a router and returns the status and JSON body.
pub async fn post(router: &Router, path: &str, body: &Value) -> (StatusCode, Value) {
    let request = Request::post(path)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .expect("request");
    send(router, request).await
}

async fn send(router: &Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = router.clone().oneshot(request).await.expect("response");
    let status = response.status();
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    let text = String::from_utf8(bytes.to_vec()).expect("utf-8 body");
    assert!(!text.contains(TOKEN), "a response leaked the token: {text}");
    let json = serde_json::from_str(&text).unwrap_or(Value::String(text));
    (status, json)
}

/// A bare repository standing in for an Artifacts remote.
pub struct Remote {
    pub dir: PathBuf,
}

impl Remote {
    pub fn url(&self) -> String {
        format!("file://{}", self.dir.display())
    }

    /// The commit a ref points at, or `None`.
    pub fn ref_sha(&self, name: &str) -> Option<String> {
        let output = Command::new("git")
            .args(["rev-parse", "--verify", "--quiet", name])
            .current_dir(&self.dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .output()
            .expect("git runs");
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
    }

    pub fn git(&self, args: &[&str]) -> String {
        git(&self.dir, args)
    }

    /// The exact content of `path` at `commit`.
    pub fn show(&self, commit: &str, path: &str) -> String {
        let output = Command::new("git")
            .args(["show", &format!("{commit}:{path}")])
            .current_dir(&self.dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .output()
            .expect("git runs");
        assert!(output.status.success(), "no {path} at {commit}");
        String::from_utf8(output.stdout).expect("utf-8")
    }
}

/// A working repository for building commits to push into remotes.
pub struct Work {
    pub dir: PathBuf,
}

impl Work {
    /// Writes `files` (path, content), stages everything, commits, and returns the sha.
    pub fn commit(&self, files: &[(&str, &str)], message: &str) -> String {
        for (path, content) in files {
            let full = self.dir.join(path);
            std::fs::create_dir_all(full.parent().expect("parent")).expect("dirs");
            std::fs::write(full, content).expect("write");
        }
        git(&self.dir, &["add", "-A"]);
        git(
            &self.dir,
            &["commit", "--quiet", "--allow-empty", "-m", message],
        );
        git(&self.dir, &["rev-parse", "HEAD"])
    }

    pub fn checkout(&self, args: &[&str]) {
        let mut all = vec!["checkout", "--quiet"];
        all.extend_from_slice(args);
        git(&self.dir, &all);
    }

    pub fn push(&self, remote: &Remote, refspec: &str) {
        git(
            &self.dir,
            &["push", "--quiet", "--force", &remote.url(), refspec],
        );
    }
}

/// A trunk holding only the arena's `main`, and a fork holding its task branches.
pub fn arena_pair(world: &World) -> (Remote, Remote) {
    let trunk = world.bare("trunk");
    trunk.git(&[
        "fetch",
        "--quiet",
        ARENA_BUNDLE,
        "refs/heads/main:refs/heads/main",
    ]);
    (trunk, world.arena("fork"))
}

/// The `change` of a squash: a task's reference branch on the fork.
pub fn change(fork: &Remote, task: &str) -> Value {
    serde_json::json!({"repo": fork.url(), "token": TOKEN, "ref": format!("refs/heads/ref/{task}")})
}

/// A squash request onto `onto`.
pub fn squash_body(trunk: &Remote, onto: &str, change: &Value) -> Value {
    serde_json::json!({
        "repo": trunk.url(), "token": TOKEN, "onto": onto, "change": change,
        "message": "Squash\n\nTask: test\n",
    })
}
