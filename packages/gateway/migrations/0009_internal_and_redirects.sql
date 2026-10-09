-- Internal repositories and old addresses (docs/claude-opus/28-organizations.md §6). Only adds.
--
-- `internal`: an org's repository every member of the org may read. 0001's CHECK on
-- `visibility` allows only public and private, and SQLite cannot change a CHECK without
-- rebuilding the table, so internal is stored as visibility 'private' with internal = 1.
-- A gateway from before this migration therefore reads an internal repository as private:
-- it fails closed.
ALTER TABLE repositories ADD COLUMN internal INTEGER NOT NULL DEFAULT 0 CHECK (internal IN (0, 1));

-- Where an old `/<owner>/<repo>` goes after a rename or a transfer: one row per old address,
-- pointing at the repository's id, so a chain (A → B → C) always lands on the current name.
-- A row is dropped when a repository is created (or renamed or moved) to exactly that
-- address, and with its repository. `owner_id` is the old owner's id: a handle change moves
-- the person's rows to the new handle (the retired handle still resolves to it).
CREATE TABLE repository_redirects (
  owner_handle TEXT NOT NULL COLLATE NOCASE,
  name_key TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  repo_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_handle, name_key)
);
CREATE INDEX repository_redirects_repo ON repository_redirects (repo_id);
CREATE INDEX repository_redirects_owner ON repository_redirects (owner_id);
