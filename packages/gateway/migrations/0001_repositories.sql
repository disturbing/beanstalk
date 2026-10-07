-- The repository registry (docs/claude-opus/20-repositories.md): who owns which repository,
-- its Artifacts repo and its engine instance. Names are unique per owner, ignoring case.
CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  owner_handle TEXT NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  origin_json TEXT NOT NULL,
  artifacts_repo TEXT NOT NULL UNIQUE,
  engine_id TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'stalk',
  -- 'provisioning' until the Artifacts repo and the engine exist; only 'ready' rows are listed.
  state TEXT NOT NULL CHECK (state IN ('provisioning', 'ready')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX repositories_owner_name ON repositories (owner_id, name_key);
CREATE INDEX repositories_handle_name ON repositories (owner_handle, name_key);

-- A repository's own history: created, renamed, described, visibility changed.
CREATE TABLE repository_activity (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL
);

CREATE INDEX repository_activity_owner ON repository_activity (owner_id, seq DESC);
