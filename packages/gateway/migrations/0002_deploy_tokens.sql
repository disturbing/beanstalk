-- Deploy tokens (docs/claude-opus/19-accounts-and-auth.md, "Connecting git"): `bsd_` tokens for
-- one repository, read or read and write, made by its owner for CI and other machines. Only
-- the SHA-256 of a token is stored. Times are unix milliseconds.
CREATE TABLE deploy_tokens (
  id TEXT PRIMARY KEY,                       -- dtok_<random>
  token_hash TEXT NOT NULL UNIQUE,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  -- Who made it: pushes with the token are pushed by them.
  created_by_id TEXT NOT NULL,
  created_by_handle TEXT NOT NULL,
  name TEXT NOT NULL,
  access TEXT NOT NULL CHECK (access IN ('read', 'write')),
  hint TEXT NOT NULL,                        -- prefix and last four characters, for lists
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  last_used_from TEXT,                       -- coarse: country and client ("US · git/2.53.0")
  revoked_at INTEGER
);

CREATE INDEX deploy_tokens_repo ON deploy_tokens (repo_id);
