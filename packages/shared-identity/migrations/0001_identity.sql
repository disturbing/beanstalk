-- Beanstalk identity (docs/claude-opus/19-accounts-and-auth.md). Every secret is stored as a
-- SHA-256 hash; nothing here can be replayed as a credential. Times are unix milliseconds.

CREATE TABLE users (
  id TEXT PRIMARY KEY,                       -- u_<random>
  handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT UNIQUE COLLATE NOCASE,          -- set only once verified (magic link)
  email_verified_at INTEGER,
  created_at INTEGER NOT NULL,
  disabled_at INTEGER
);

CREATE TABLE passkeys (
  credential_id TEXT PRIMARY KEY,            -- base64url credential id
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,                  -- base64url COSE public key
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',     -- JSON array
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX passkeys_user ON passkeys(user_id);

CREATE TABLE web_sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  user_agent TEXT,
  revoked_at INTEGER
);
CREATE INDEX web_sessions_user ON web_sessions(user_id);

-- WebAuthn ceremonies in flight: one row per options request, single use, five minutes.
CREATE TABLE auth_challenges (
  id_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('signup', 'signin', 'add_passkey')),
  challenge TEXT NOT NULL,
  user_id TEXT,                              -- the new or existing user the ceremony is for
  handle TEXT,                               -- the handle a sign-up asked for
  expires_at INTEGER NOT NULL
);

CREATE TABLE magic_links (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  purpose TEXT NOT NULL CHECK (purpose IN ('signin', 'signup')),
  handle TEXT,
  browser_hash TEXT NOT NULL,                -- the pre-auth cookie of the browser that asked
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

-- Personal access tokens (bsu_) and short-lived session tokens for agent sessions (bss_).
CREATE TABLE user_tokens (
  id TEXT PRIMARY KEY,                       -- tok_<random>
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('personal', 'session')),
  name TEXT NOT NULL,
  scopes TEXT NOT NULL,                      -- space-separated: read collaborate write
  hint TEXT NOT NULL,                        -- prefix and last four characters, for lists
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER,
  oauth_client_id TEXT                       -- the MCP (OAuth) client a session token was minted for
);
CREATE INDEX user_tokens_user ON user_tokens(user_id, kind);
CREATE INDEX user_tokens_client ON user_tokens(user_id, oauth_client_id);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  ip_hash TEXT,
  detail TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_events_actor ON audit_events(actor_user_id, at);
