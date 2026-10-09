-- Organizations (docs/claude-opus/28-organizations.md). An org's handle shares one namespace
-- with people's handles: the triggers refuse a handle the other table holds, so the check is
-- atomic with the insert. Times are unix milliseconds, like the rest of this database.

CREATE TABLE orgs (
  id TEXT PRIMARY KEY,                       -- org_<random>
  handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_key TEXT,                             -- an uploaded image's key (the uploads API); null: initials
  -- What every member may do with every org repository before collaborator roles.
  base_permission TEXT NOT NULL DEFAULT 'read' CHECK (base_permission IN ('none', 'read', 'write')),
  -- Who may create repositories in the org: members too, or owners and admins only.
  repo_creation TEXT NOT NULL DEFAULT 'members' CHECK (repo_creation IN ('members', 'admins')),
  default_visibility TEXT NOT NULL DEFAULT 'private' CHECK (default_visibility IN ('public', 'private')),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TRIGGER orgs_handle_free BEFORE INSERT ON orgs
WHEN EXISTS (SELECT 1 FROM users WHERE handle = NEW.handle COLLATE NOCASE)
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE constraint failed: handle is a person''s');
END;

CREATE TRIGGER users_handle_free BEFORE INSERT ON users
WHEN EXISTS (SELECT 1 FROM orgs WHERE handle = NEW.handle COLLATE NOCASE)
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE constraint failed: handle is an organization''s');
END;

CREATE TABLE org_members (
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  added_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX org_members_user ON org_members(user_id);

-- Waiting for the invitee's answer on their Home. One per person and org; a new one replaces it.
CREATE TABLE org_invitations (
  id TEXT PRIMARY KEY,                       -- oinv_<random>
  org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  invitee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  invited_by_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX org_invitations_once ON org_invitations(org_id, invitee_id);
CREATE INDEX org_invitations_invitee ON org_invitations(invitee_id);

-- The org's security log: created, settings, invitations and answers, roles, removals, leaving.
-- Kept after the org is deleted (no foreign key), so its deletion is on record. No secrets.
CREATE TABLE org_audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  actor_handle TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  target_handle TEXT,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX org_audit_org ON org_audit(org_id, seq DESC);
