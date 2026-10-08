-- Actions (docs/claude-opus/25-actions-and-automations.md): the workflow index, the run list,
-- secrets and job tokens. The run DAG lives in each run's Durable Object; logs live in R2.

-- The workflows of each repository as the stalk holds them, rebuilt when the stalk moves.
-- `summary_json` is the WorkflowSummary the RPC returns; `source` the file, for runs.
CREATE TABLE actions_workflows (
  repo_id TEXT NOT NULL,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'invalid')),
  sha TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  source TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  PRIMARY KEY (repo_id, path)
);

-- One row per run, written by the run's Durable Object at each state change.
CREATE TABLE actions_runs (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  workflow_path TEXT NOT NULL,
  workflow_name TEXT NOT NULL,
  event TEXT NOT NULL,
  ref TEXT NOT NULL,
  sha TEXT NOT NULL,
  status TEXT NOT NULL,
  conclusion TEXT,
  reason TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  minutes_billed INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX actions_runs_repo ON actions_runs (repo_id, created_ms DESC);
CREATE INDEX actions_runs_workflow ON actions_runs (repo_id, workflow_path, created_ms DESC);

-- Encrypted at rest (AES-GCM, ACTIONS_SECRETS_KEY); the value is never returned.
CREATE TABLE actions_secrets (
  repo_id TEXT NOT NULL,
  name TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  preland_allowed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (repo_id, name)
);

-- Job tokens (bsj_…, GITHUB_TOKEN): SHA-256 of the token, bound to one repository engine and
-- one job, revoked when the job ends.
CREATE TABLE actions_job_tokens (
  token_hash TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  engine_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  can_push INTEGER NOT NULL DEFAULT 0,
  expires_ms INTEGER NOT NULL,
  revoked_ms INTEGER
);

CREATE INDEX actions_job_tokens_job ON actions_job_tokens (job_id);
