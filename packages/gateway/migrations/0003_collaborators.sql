-- Collaborators and visibility (docs/claude-opus/22-collaborators.md). The owner stays on the
-- repositories row; everyone else with access is a member here, with a role. Times are ISO 8601.
CREATE TABLE repository_members (
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  user_handle TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('read', 'write', 'maintain')),
  added_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (repo_id, user_id)
);

CREATE INDEX repository_members_user ON repository_members (user_id);

-- Invitations waiting for an answer. Accepting moves the row into repository_members;
-- declining, cancelling and expiry delete it. One pending invitation per person and repository.
CREATE TABLE repository_invitations (
  id TEXT PRIMARY KEY,                       -- inv_<random>
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  invitee_id TEXT NOT NULL,
  invitee_handle TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('read', 'write', 'maintain')),
  invited_by_id TEXT NOT NULL,
  invited_by_handle TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE UNIQUE INDEX repository_invitations_once ON repository_invitations (repo_id, invitee_id);
CREATE INDEX repository_invitations_invitee ON repository_invitations (invitee_id);

-- Which credentials acted on a repository, for whom: "People on the repo". One row per
-- credential; reads and pushes are stamped (reads at most once a minute).
CREATE TABLE repository_sessions (
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  credential_key TEXT NOT NULL,              -- '<via>:<id>' (a token id, a key fingerprint)
  user_id TEXT NOT NULL,
  user_handle TEXT NOT NULL,
  via TEXT NOT NULL CHECK (via IN ('personal-token', 'agent-session', 'ssh-key', 'deploy-token', 'mcp')),
  label TEXT NOT NULL,
  last_read_at TEXT,
  last_push_at TEXT,
  pushes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (repo_id, credential_key)
);

-- The security log of a repository's access: invitations, answers, role changes, removals,
-- visibility. Never carries a secret.
CREATE TABLE repository_audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id TEXT NOT NULL,
  at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_handle TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  target_handle TEXT,
  detail TEXT NOT NULL DEFAULT ''
);

CREATE INDEX repository_audit_repo ON repository_audit (repo_id, seq DESC);
