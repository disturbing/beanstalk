-- Actions org secrets and variables (docs/claude-opus/25-actions-and-automations.md §3.4).
-- Org secrets are encrypted like repository secrets (AES-GCM, ACTIONS_SECRETS_KEY, the org and
-- the name as additional data) and carry a repository access policy; variables are plain text.
-- A repository entry wins over an org entry of the same name.

CREATE TABLE actions_org_secrets (
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  -- all: every repository of the org; private: its private ones; selected: actions_org_entry_repos.
  access TEXT NOT NULL CHECK (access IN ('all', 'private', 'selected')),
  preland_allowed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (org_id, name)
);

CREATE TABLE actions_variables (
  repo_id TEXT NOT NULL,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (repo_id, name)
);

CREATE TABLE actions_org_variables (
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  access TEXT NOT NULL CHECK (access IN ('all', 'private', 'selected')),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (org_id, name)
);

-- The selected repositories of an org secret or variable whose access is 'selected'.
CREATE TABLE actions_org_entry_repos (
  org_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('secret', 'variable')),
  name TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  PRIMARY KEY (org_id, kind, name, repo_id)
);

CREATE INDEX actions_org_entry_repos_repo ON actions_org_entry_repos (repo_id);

-- Org-level changes to Actions secrets and variables (names and policies, never values).
CREATE TABLE actions_org_audit (
  org_id TEXT NOT NULL,
  at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_handle TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL
);

CREATE INDEX actions_org_audit_org ON actions_org_audit (org_id, at DESC);
