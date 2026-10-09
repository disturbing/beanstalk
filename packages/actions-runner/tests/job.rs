//! The job runner end to end over HTTP: a real git repository (file://) holds the workflow, a
//! fake `act` prints act's JSON lines, and a fake executor collects the batches and the result.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use actions_runner::app::{AppState, router};
use actions_runner::config::Config;
use axum::Json;
use axum::extract::State;
use axum::routing::post;
use serde_json::{Value, json};
use tempfile::TempDir;
use tokio::sync::{mpsc, watch};

type TestResult = anyhow::Result<()>;

const WAIT: Duration = Duration::from_secs(30);

const WORKFLOW: &str = "name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.build.outputs.version }}
    steps:
      - id: build
        run: echo build
  db:
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis
    steps:
      - run: redis-cli ping
";

/// act's lines for a green job that prints a secret and sets an output.
const GREEN_ACT: &str = r#"#!/bin/sh
printf '%s\n' "$@" > ../act-args.txt
cp "$3" ../act-workflow.yml
cat <<'EOF'
{"level":"info","msg":"⭐ Run Main build","stage":"Main","step":"build","stepID":["build"]}
{"msg":"token npm-secret-value here\n","raw_output":true,"stage":"Main","step":"build","stepID":["build"]}
{"arg":"1.2.3","command":"set-output","level":"info","msg":"x","name":"version","stage":"Main","step":"build","stepID":["build"]}
{"arg":"careful","command":"warning","kvPairs":{"file":"a.js","line":"2"},"level":"warning","msg":"x","stage":"Main","step":"build","stepID":["build"]}
{"executionTime":2000000,"level":"info","msg":"  ✅  Success - Main build [2ms]","stage":"Main","step":"build","stepID":["build"],"stepResult":"success"}
{"error":"repository does not exist","level":"error","msg":"path/x not located inside a git repository"}
{"jobResult":"success","level":"info","msg":"🏁  Job succeeded"}
EOF
"#;

/// act that ignores SIGTERM and never ends: only SIGKILL stops it.
const STUBBORN_ACT: &str = r#"#!/bin/sh
trap '' TERM
echo '{"level":"info","msg":"⭐ Run Main build","stage":"Main","step":"build","stepID":["build"]}'
exec tail -f /dev/null
"#;

struct Received {
    batches: Vec<Value>,
    count: watch::Sender<usize>,
}

struct Harness {
    _dir: TempDir,
    root: PathBuf,
    runner: String,
    received: Arc<Mutex<Received>>,
    results: mpsc::UnboundedReceiver<Value>,
    sha: String,
}

impl Harness {
    async fn start(act_script: &str) -> anyhow::Result<Self> {
        let dir = TempDir::new()?;
        let root = dir.path().to_path_buf();
        let sha = make_repository(&root.join("repos/coop/app"))?;
        let act = root.join("fake-act");
        std::fs::write(&act, act_script)?;
        std::fs::set_permissions(&act, std::fs::Permissions::from_mode(0o755))?;
        let (count, _) = watch::channel(0);
        // A Docker daemon that stays up and a client that finds it ready.
        let dockerd = root.join("fake-dockerd");
        let docker = root.join("fake-docker");
        std::fs::write(&dockerd, "#!/bin/sh\nexec tail -f /dev/null\n")?;
        std::fs::write(&docker, "#!/bin/sh\nexit 0\n")?;
        for script in [&dockerd, &docker] {
            std::fs::set_permissions(script, std::fs::Permissions::from_mode(0o755))?;
        }
        let received = Arc::new(Mutex::new(Received {
            batches: Vec::new(),
            count,
        }));
        let (sender, results) = mpsc::unbounded_channel();
        let executor = serve(executor_app(received.clone(), sender)).await?;
        let work_root = root.join("work");
        let config = Config::from_lookup(|name| match name {
            "WORK_ROOT" => Some(work_root.display().to_string()),
            "ACT_BIN" => Some(act.display().to_string()),
            "EXECUTOR_URL" => Some(executor.clone()),
            "CANCEL_GRACE_SECONDS" => Some("1".into()),
            "DOCKERD" => Some(dockerd.display().to_string()),
            "DOCKER_BIN" => Some(docker.display().to_string()),
            _ => None,
        })?;
        let runner = serve(router(AppState::new(config)?)).await?;
        Ok(Self {
            _dir: dir,
            root,
            runner,
            received,
            results,
            sha,
        })
    }

    fn job(&self, job_name: &str) -> Value {
        json!({
            "jobId": "6f0d6f6e-0000-4000-8000-000000000001",
            "workflowPath": ".github/workflows/ci.yml",
            "jobName": job_name,
            "eventName": "push",
            "eventPayload": { "ref": "refs/heads/main" },
            "github": {
                "repository": "coop/app", "ref": "refs/heads/main", "sha": self.sha,
                "serverUrl": format!("file://{}", self.root.join("repos").display()),
                "apiUrl": "http://bs.internal/api/v3",
                "runId": "1", "runNumber": "1", "runAttempt": "1", "actor": "coop"
            },
            "token": "bsj_job_token_value",
            "secrets": { "NPM_TOKEN": "npm-secret-value" },
            "timeoutSeconds": 600,
            "runnerLabels": ["ubuntu-latest"]
        })
    }

    async fn post(&self, path: &str, body: &Value) -> anyhow::Result<reqwest::Response> {
        Ok(reqwest::Client::new()
            .post(format!("{}{path}", self.runner))
            .json(body)
            .send()
            .await?)
    }

    async fn next_result(&mut self) -> anyhow::Result<Value> {
        tokio::time::timeout(WAIT, self.results.recv())
            .await?
            .ok_or_else(|| anyhow::anyhow!("the executor stopped"))
    }

    /// Waits until a received line matches `wanted`.
    async fn wait_for_line(&self, wanted: impl Fn(&Value) -> bool) -> TestResult {
        let mut count = match self.received.lock() {
            Ok(received) => received.count.subscribe(),
            Err(_) => anyhow::bail!("poisoned"),
        };
        while !self.lines().iter().any(&wanted) {
            tokio::time::timeout(WAIT, count.changed()).await??;
        }
        Ok(())
    }

    fn lines(&self) -> Vec<Value> {
        let batches = match self.received.lock() {
            Ok(received) => received.batches.clone(),
            Err(poisoned) => poisoned.into_inner().batches.clone(),
        };
        batches
            .iter()
            .flat_map(|batch| batch["lines"].as_array().cloned().unwrap_or_default())
            .collect()
    }
}

fn make_repository(path: &Path) -> anyhow::Result<String> {
    std::fs::create_dir_all(path.join(".github/workflows"))?;
    std::fs::write(path.join(".github/workflows/ci.yml"), WORKFLOW)?;
    let git = |args: &[&str]| -> anyhow::Result<String> {
        let output = Command::new("git")
            .args(args)
            .current_dir(path)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@example.com")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@example.com")
            .output()?;
        anyhow::ensure!(output.status.success(), "git {args:?} failed");
        Ok(String::from_utf8(output.stdout)?.trim().to_owned())
    };
    git(&["init", "-q", "-b", "main"])?;
    git(&["config", "uploadpack.allowAnySHA1InWant", "true"])?;
    git(&["add", "."])?;
    git(&["commit", "-q", "-m", "ci"])?;
    git(&["rev-parse", "HEAD"])
}

fn executor_app(
    received: Arc<Mutex<Received>>,
    results: mpsc::UnboundedSender<Value>,
) -> axum::Router {
    axum::Router::new()
        .route(
            "/v1/batches",
            post(
                |State(received): State<Arc<Mutex<Received>>>, Json(body): Json<Value>| async move {
                    if let Ok(mut received) = received.lock() {
                        received.batches.push(body);
                        let total = received.batches.len();
                        received.count.send_replace(total);
                    }
                    Json(json!({ "ok": true }))
                },
            ),
        )
        .with_state(received)
        .route(
            "/v1/result",
            post(move |Json(body): Json<Value>| async move {
                let _ = results.send(body);
                Json(json!({ "ok": true }))
            }),
        )
}

async fn serve(app: axum::Router) -> anyhow::Result<String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    Ok(format!("http://{address}"))
}

#[tokio::test]
async fn runs_a_job_streams_masked_lines_and_reports_its_result() -> TestResult {
    let mut harness = Harness::start(GREEN_ACT).await?;
    let accepted = harness.post("/v1/job", &harness.job("build")).await?;
    assert_eq!(accepted.status(), 202);

    let result = harness.next_result().await?;
    assert_eq!(result["conclusion"], "success");
    assert_eq!(result["outputs"]["version"], "1.2.3");
    assert_eq!(result["steps"][0]["result"], "success");
    assert_eq!(result["annotations"][0]["file"], "a.js");

    let lines = harness.lines();
    let texts: Vec<&str> = lines
        .iter()
        .filter_map(|line| line["text"].as_str())
        .collect();
    assert!(texts.contains(&"token *** here"), "{texts:?}");
    assert!(!texts.iter().any(|text| text.contains("npm-secret-value")));
    assert!(!texts.iter().any(|text| text.contains("not located inside")));
    let seqs: Vec<u64> = lines
        .iter()
        .filter_map(|line| line["seq"].as_u64())
        .collect();
    assert!(
        seqs.iter()
            .zip(0_u64..)
            .all(|(seq, expected)| *seq == expected)
    );
    Ok(())
}

#[tokio::test]
async fn hands_act_the_one_job_and_no_secret_on_its_command_line() -> TestResult {
    let mut harness = Harness::start(GREEN_ACT).await?;
    harness.post("/v1/job", &harness.job("build")).await?;
    harness.next_result().await?;
    let args = std::fs::read_to_string(harness.root.join("work/act-args.txt"))?;
    assert!(args.contains("ubuntu-latest=-self-hosted"));
    assert!(!args.contains("npm-secret-value") && !args.contains("bsj_job_token_value"));
    let workflow = std::fs::read_to_string(harness.root.join("work/act-workflow.yml"))?;
    assert!(workflow.contains("build:") && !workflow.contains("db:"));
    let secrets = harness.root.join("work/_job/job.secrets");
    assert!(!secrets.exists(), "the secret file outlived the job");
    Ok(())
}

#[tokio::test]
async fn runs_a_compiled_workflow_source_without_reading_the_path_at_the_commit() -> TestResult {
    let mut harness = Harness::start(GREEN_ACT).await?;
    let mut job = harness.job("agent");
    job["workflowPath"] = json!(".beanstalk/automations/fix-red.yml");
    job["workflowSource"] = json!(
        "on: workflow_dispatch\njobs:\n  agent:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo compiled\n"
    );
    assert_eq!(harness.post("/v1/job", &job).await?.status(), 202);
    let result = harness.next_result().await?;
    assert_eq!(result["conclusion"], "success");
    let workflow = std::fs::read_to_string(harness.root.join("work/act-workflow.yml"))?;
    assert!(workflow.contains("echo compiled"), "{workflow}");
    assert!(harness.lines().iter().any(|line| {
        line["text"]
            .as_str()
            .is_some_and(|text| text.contains("as compiled by Beanstalk"))
    }));
    Ok(())
}

#[tokio::test]
async fn never_runs_a_second_job_in_the_same_container() -> TestResult {
    let mut harness = Harness::start(GREEN_ACT).await?;
    harness.post("/v1/job", &harness.job("build")).await?;
    let second = harness.post("/v1/job", &harness.job("build")).await?;
    assert_eq!(second.status(), 409);
    harness.next_result().await?;
    let third = harness.post("/v1/job", &harness.job("build")).await?;
    assert_eq!(third.status(), 409);
    Ok(())
}

#[tokio::test]
async fn runs_a_job_with_services_in_docker_mode_instead_of_skipping_them() -> TestResult {
    let mut harness = Harness::start(GREEN_ACT).await?;
    harness.post("/v1/job", &harness.job("db")).await?;
    let result = harness.next_result().await?;
    assert_eq!(result["conclusion"], "success");
    let args = std::fs::read_to_string(harness.root.join("work/act-args.txt"))?;
    assert!(args.contains("ubuntu-latest=catthehacker/ubuntu:act-24.04"));
    assert!(args.contains("unix:///var/run/docker.sock"));
    assert!(harness.lines().iter().any(|line| {
        line["text"]
            .as_str()
            .is_some_and(|text| text.starts_with("The job uses `services:`: starting Docker"))
    }));
    Ok(())
}

#[tokio::test]
async fn reports_a_missing_job_as_a_workflow_failure() -> TestResult {
    let mut harness = Harness::start(GREEN_ACT).await?;
    harness.post("/v1/job", &harness.job("release")).await?;
    let result = harness.next_result().await?;
    assert_eq!(result["reason"], "workflow");
    Ok(())
}

#[tokio::test]
async fn cancel_kills_act_even_when_it_ignores_sigterm() -> TestResult {
    let mut harness = Harness::start(STUBBORN_ACT).await?;
    harness.post("/v1/job", &harness.job("build")).await?;
    harness
        .wait_for_line(|line| line["kind"] == "step-start")
        .await?;
    let cancelled = harness
        .post("/v1/cancel", &json!({ "reason": "cancelled" }))
        .await?;
    assert_eq!(cancelled.status(), 202);
    let result = harness.next_result().await?;
    assert_eq!(result["conclusion"], "cancelled");
    assert!(
        harness
            .lines()
            .iter()
            .any(|line| line["text"] == "The job was cancelled: stopping it")
    );
    Ok(())
}

#[tokio::test]
async fn a_job_past_its_timeout_fails_as_timed_out() -> TestResult {
    let mut harness = Harness::start(STUBBORN_ACT).await?;
    let mut job = harness.job("build");
    job["timeoutSeconds"] = json!(1);
    harness.post("/v1/job", &job).await?;
    let result = harness.next_result().await?;
    assert_eq!(result["conclusion"], "failure");
    assert_eq!(result["reason"], "timeout");
    Ok(())
}
