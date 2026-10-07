-- Repository events and archive (docs/claude-opus/20-repositories.md §6, §7; backlog 2.6, 2.2).
-- Engines publish their events through the `repo-events` Queue; the consumer keeps these
-- indexes, so the web's lists are D1 reads. Every write is idempotent: a redelivered or
-- out-of-order event changes nothing it should not. Times are ISO 8601.

-- Archive: read-only (no pushes, decisions or deploy tokens) and out of default lists.
ALTER TABLE repositories ADD COLUMN archived_at TEXT;

-- Engine lines share the activity table with the registry's own lines. `event_key` is
-- '<engine>:<seq>', unique, so a redelivered event is one line; registry lines leave it null.
ALTER TABLE repository_activity ADD COLUMN event_key TEXT;
ALTER TABLE repository_activity ADD COLUMN bean TEXT;
ALTER TABLE repository_activity ADD COLUMN sha TEXT;
CREATE UNIQUE INDEX repository_activity_event ON repository_activity (event_key);
CREATE INDEX repository_activity_repo ON repository_activity (repo_id, seq DESC);
CREATE INDEX repository_activity_repo_day ON repository_activity (repo_id, kind, at);

-- Every bean a repository's engine has seen. `state_seq` is the engine seq of the event that
-- set `state`: an older event never overwrites a newer state.
CREATE TABLE beans (
  repo_id TEXT NOT NULL,
  bean TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  actor TEXT,
  state TEXT NOT NULL CHECK (state IN ('growing', 'landed', 'promoted', 'reverted', 'dropped', 'parked')),
  state_seq INTEGER NOT NULL,
  opened_at TEXT,
  landed_at TEXT,
  landed_sha TEXT,
  landed_idx INTEGER,
  promoted_at TEXT,
  promoted_sha TEXT,
  reverted_at TEXT,
  reason TEXT NOT NULL DEFAULT '',
  reworks INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (repo_id, bean)
);

CREATE INDEX beans_repo_state ON beans (repo_id, state, updated_at DESC);

-- Decision cards, open and answered.
CREATE TABLE decisions (
  repo_id TEXT NOT NULL,
  card TEXT NOT NULL,
  bean TEXT NOT NULL DEFAULT '',
  against_json TEXT NOT NULL DEFAULT '[]',
  reason TEXT,
  state TEXT NOT NULL CHECK (state IN ('open', 'decided')),
  asked_at TEXT,
  winner TEXT,
  loser TEXT,
  decided_by TEXT,
  decided_at TEXT,
  PRIMARY KEY (repo_id, card)
);

CREATE INDEX decisions_repo_state ON decisions (repo_id, state);

-- Counts per repository and UTC day, recomputed from the activity lines (so redelivery is
-- harmless): the Stalk tab now, Insights later.
CREATE TABLE repo_daily (
  repo_id TEXT NOT NULL,
  day TEXT NOT NULL,
  landed INTEGER NOT NULL DEFAULT 0,
  promoted INTEGER NOT NULL DEFAULT 0,
  reverted INTEGER NOT NULL DEFAULT 0,
  red_validations INTEGER NOT NULL DEFAULT 0,
  reworks INTEGER NOT NULL DEFAULT 0,
  decisions INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (repo_id, day)
);

-- The heads of the sprout and the stalk, each moved only by a newer event.
CREATE TABLE repo_lines (
  repo_id TEXT PRIMARY KEY,
  sprout_sha TEXT,
  sprout_idx INTEGER,
  sprout_seq INTEGER NOT NULL DEFAULT 0,
  stalk_sha TEXT,
  stalk_idx INTEGER,
  stalk_seq INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
