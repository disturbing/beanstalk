-- SSH keys (docs/claude-opus/19-accounts-and-auth.md, "Connecting git"): the SSH endpoint maps
-- an offered key to its person (findUserByKey). Only public keys are stored. Times are unix
-- milliseconds.

CREATE TABLE ssh_keys (
  id TEXT PRIMARY KEY,                       -- key_<random>
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                        -- the machine it was added from, or a label
  key_type TEXT NOT NULL,                    -- ssh-ed25519, ecdsa-sha2-nistp256, ssh-rsa…
  public_key TEXT NOT NULL,                  -- base64 of the SSH wire-format key blob
  fingerprint TEXT NOT NULL,                 -- SHA256:<base64>, as ssh-keygen -l prints it
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  removed_at INTEGER
);
CREATE INDEX ssh_keys_user ON ssh_keys(user_id);
-- A key opens one account: it can be added again only after it was removed.
CREATE UNIQUE INDEX ssh_keys_active_fingerprint ON ssh_keys(fingerprint) WHERE removed_at IS NULL;

-- "Add this key" requests from a terminal (the setup script), approved in the browser by the
-- signed-in person, on the same machine or another device (a short code, RFC 8628 style).
CREATE TABLE ssh_key_requests (
  id TEXT PRIMARY KEY,                       -- kreq_<random>
  user_code_hash TEXT NOT NULL UNIQUE,       -- what the person types or the link carries
  poll_hash TEXT NOT NULL UNIQUE,            -- what the terminal polls the outcome with
  public_key TEXT NOT NULL,                  -- the key line as the terminal sent it
  key_type TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  wants_https_token INTEGER NOT NULL DEFAULT 0, -- also give the terminal an HTTPS token (until SSH is live)
  token_delivered_at INTEGER,                -- that token is minted once, on the first approved poll
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
