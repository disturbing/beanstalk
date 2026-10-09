-- Organizations own repositories too (docs/claude-opus/28-organizations.md). owner_id is then
-- the org's id (`org_…`, in IDENTITY_DB) and owner_handle its handle; existing rows are people's.
ALTER TABLE repositories ADD COLUMN owner_kind TEXT NOT NULL DEFAULT 'user'
  CHECK (owner_kind IN ('user', 'org'));
