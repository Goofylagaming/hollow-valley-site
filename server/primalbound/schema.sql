-- Primalbound cloud accounts; no Hollow Valley or Stripe tables are touched.
CREATE TABLE IF NOT EXISTS pb_users (
 id uuid PRIMARY KEY,
 username varchar(24) NOT NULL,
 username_lower varchar(24) NOT NULL UNIQUE,
 password_hash text NOT NULL,
 failed_attempts integer NOT NULL DEFAULT 0,
 locked_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pb_sessions (
 token_hash char(64) PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES pb_users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pb_sessions_user ON pb_sessions(user_id);
CREATE INDEX IF NOT EXISTS pb_sessions_expiry ON pb_sessions(expires_at);
CREATE TABLE IF NOT EXISTS pb_saves (
 user_id uuid PRIMARY KEY REFERENCES pb_users(id) ON DELETE CASCADE,
 save_data jsonb NOT NULL,
 revision integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);


-- Keep previous validated revisions for recovery from accidental overwrites.
-- These are stored in the same database: external backups remain essential.
CREATE TABLE IF NOT EXISTS pb_save_history (
 user_id uuid NOT NULL REFERENCES pb_users(id) ON DELETE CASCADE,
 revision integer NOT NULL,
 save_data jsonb NOT NULL,
 saved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id,revision)
);
CREATE INDEX IF NOT EXISTS pb_save_history_recency
 ON pb_save_history(user_id,revision DESC);
