-- Profiles and handle changes (docs/claude-opus/29-settings.md). Only adds: existing people get
-- an empty profile and no picture (the generated fallback). Times are unix milliseconds.

ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN website TEXT NOT NULL DEFAULT '';
-- R2 key in beanstalk-media: users/<id>/avatar/<hash> (@beanstalk/shared-media).
ALTER TABLE users ADD COLUMN avatar_key TEXT;
ALTER TABLE users ADD COLUMN handle_changed_at INTEGER;

-- Handles a person used before. Each one keeps redirecting to them (web pages and git), so no
-- one else can take it; its owner can take it back.
CREATE TABLE retired_handles (
  handle TEXT PRIMARY KEY COLLATE NOCASE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  retired_at INTEGER NOT NULL
);
CREATE INDEX retired_handles_user ON retired_handles(user_id);

-- One namespace with organisations (0004_orgs.sql): a retired handle is not free for a new
-- organisation, and a handle change cannot take an organisation's handle.
CREATE TRIGGER orgs_handle_not_retired BEFORE INSERT ON orgs
WHEN EXISTS (SELECT 1 FROM retired_handles WHERE handle = NEW.handle COLLATE NOCASE)
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE constraint failed: handle is a retired handle');
END;

CREATE TRIGGER users_handle_change_free BEFORE UPDATE OF handle ON users
WHEN EXISTS (SELECT 1 FROM orgs WHERE handle = NEW.handle COLLATE NOCASE)
BEGIN
  SELECT RAISE(ABORT, 'UNIQUE constraint failed: handle is an organization''s');
END;
