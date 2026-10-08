//! The wire contract with the executor's Durable Object (`packages/actions-executor`,
//! `src/job/runner-wire.ts`). Inbound: the job. Outbound: live batches, durable chunks, the
//! result. Field names are camelCase on the wire; bump [`API_VERSION`] with any change.

use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Serialize};

/// The version of this contract; `ACTIONS_RUNNER_API_VERSION` in the executor must match.
pub const API_VERSION: u32 = 1;

/// A value that must never be logged: the job token or a secret.
#[derive(Clone, Deserialize, PartialEq, Eq)]
#[serde(transparent)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("Secret(***)")
    }
}

/// `POST /v1/job`: everything the job needs. Secrets arrive only here, by value, for the names
/// the job references; they are written to a 0600 file that `act` reads and are masked in every
/// line that leaves the container.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobRequest {
    pub job_id: String,
    /// `.github/workflows/ci.yml`, relative to the repository root.
    pub workflow_path: String,
    /// The job's key under `jobs:`.
    pub job_name: String,
    pub event_name: String,
    pub event_payload: serde_json::Value,
    pub github: GithubContext,
    /// The scoped job token: `GITHUB_TOKEN` and the checkout credential.
    pub token: Secret,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub vars: BTreeMap<String, String>,
    #[serde(default)]
    pub secrets: BTreeMap<String, Secret>,
    /// One matrix leg: `--matrix key:value` per entry (one container per leg).
    #[serde(default)]
    pub matrix: BTreeMap<String, serde_json::Value>,
    /// `workflow_dispatch` inputs (`inputs.*`).
    #[serde(default)]
    pub inputs: BTreeMap<String, String>,
    /// The job's `outputs:` templates as the control plane read them; when empty, the ones in
    /// the workflow file are used.
    #[serde(default)]
    pub outputs: BTreeMap<String, String>,
    /// The jobs this one `needs`, already finished: their result and outputs.
    #[serde(default)]
    pub needs: BTreeMap<String, NeededJob>,
    pub timeout_seconds: u64,
    /// `runs-on` labels that run on this image (`ubuntu-latest`, `ubuntu-24.04`, ...).
    pub runner_labels: Vec<String>,
}

/// The `github` context act cannot work out without a local clone.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GithubContext {
    /// `owner/repo`.
    pub repository: String,
    /// `refs/heads/main`.
    #[serde(rename = "ref")]
    pub git_ref: String,
    pub sha: String,
    /// Where `actions/checkout` clones from and act fetches actions from: the executor's
    /// `bs.internal` virtual host.
    pub server_url: String,
    pub api_url: String,
    pub run_id: String,
    pub run_number: String,
    pub run_attempt: String,
    pub actor: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NeededJob {
    pub result: String,
    #[serde(default)]
    pub outputs: BTreeMap<String, String>,
}

/// `POST /v1/cancel`.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CancelRequest {
    pub reason: StopReason,
}

/// Why a job stopped before act finished it.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StopReason {
    Timeout,
    Cancelled,
}

/// One log line as it leaves the container (already masked).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub seq: u64,
    /// Milliseconds since the Unix epoch.
    pub at: u64,
    pub kind: LineKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
    pub level: Level,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotation: Option<Annotation>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LineKind {
    /// What a step printed.
    Output,
    StepStart,
    StepEnd,
    /// `::error::`, `::warning::`, `::notice::`.
    Annotation,
    GroupStart,
    GroupEnd,
    /// `$GITHUB_STEP_SUMMARY` content.
    Summary,
    /// `::debug::` (shown when step debug logging is on).
    Debug,
    /// act's own messages (cloning an action, the job result) and the runner's.
    Runner,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Debug,
    Info,
    Notice,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub level: Level,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub col: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_column: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_id: Option<String>,
}

/// `POST <executor>/v1/batches`: lines in order (`index` from 0; empty = heartbeat). The
/// executor relays them and has them stored before it acknowledges.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Batch<'a> {
    pub job_id: &'a str,
    pub index: u32,
    pub lines: &'a [LogLine],
}

/// How the job ended, as act reported it (or why it did not get to).
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Conclusion {
    Success,
    Failure,
    Cancelled,
    Skipped,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FailureReason {
    /// A step failed (the ordinary red).
    Steps,
    Timeout,
    Cancelled,
    /// The workflow file is missing, does not parse or has no such job.
    Workflow,
    /// The job needs what this executor does not run yet (`services:`, `container:`, Docker
    /// actions): refused before any step, never skipped into a false green.
    Unsupported,
    /// act or the runner itself failed: infrastructure, not the code under test.
    Runner,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StepRecord {
    pub id: String,
    pub name: String,
    pub stage: String,
    pub result: String,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StepSummary {
    pub step_id: String,
    pub markdown: String,
}

/// `POST <executor>/v1/result`, sent after the last chunk was acknowledged.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerResult {
    pub job_id: String,
    pub conclusion: Conclusion,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<FailureReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    pub outputs: BTreeMap<String, String>,
    pub unresolved_outputs: Vec<String>,
    pub step_outputs: BTreeMap<String, BTreeMap<String, String>>,
    pub steps: Vec<StepRecord>,
    pub annotations: Vec<Annotation>,
    pub summaries: Vec<StepSummary>,
    pub started_at: u64,
    pub finished_at: u64,
    pub lines: u64,
    pub batches: u32,
    pub act_version: String,
    pub image_version: String,
}

/// `GET /version`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionResponse {
    pub api_version: u32,
    pub act_version: String,
    pub image_version: String,
}

/// `GET /v1/status` and `GET /healthz`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum StatusResponse {
    Idle,
    Running { job_id: String, started_at: u64 },
    Finished { result: Box<RunnerResult> },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_secret_never_shows_in_debug_output() {
        let secret = Secret::new("hunter2-value");
        assert_eq!(format!("{secret:?}"), "Secret(***)");
    }

    #[test]
    fn refuses_unknown_request_fields() {
        let body = serde_json::json!({
            "jobId": "j", "workflowPath": ".github/workflows/ci.yml", "jobName": "test",
            "eventName": "push", "eventPayload": {}, "token": "t", "timeoutSeconds": 60,
            "runnerLabels": ["ubuntu-latest"], "surprise": true,
            "github": { "repository": "o/r", "ref": "refs/heads/main", "sha": "abc",
              "serverUrl": "http://bs.internal", "apiUrl": "http://bs.internal/api/v3",
              "runId": "1", "runNumber": "1", "runAttempt": "1", "actor": "coop" }
        });
        assert!(serde_json::from_value::<JobRequest>(body).is_err());
    }

    #[test]
    fn log_lines_serialise_in_camel_case_without_empty_fields() -> serde_json::Result<()> {
        let line = LogLine {
            seq: 3,
            at: 10,
            kind: LineKind::StepEnd,
            stage: Some("Main".into()),
            step_id: Some("greet".into()),
            step: Some("Greet".into()),
            level: Level::Info,
            text: "Success".into(),
            result: Some("success".into()),
            duration_ms: Some(12),
            annotation: None,
        };
        let json = serde_json::to_value(&line)?;
        assert_eq!(json["kind"], "step-end");
        assert_eq!(json["stepId"], "greet");
        assert_eq!(json["durationMs"], 12);
        assert!(json.get("annotation").is_none());
        Ok(())
    }
}
