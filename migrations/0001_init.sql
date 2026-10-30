-- Move Club schema

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,            -- format: pbkdf2$<iterations>$<saltHex>$<hashHex>
  color         TEXT NOT NULL DEFAULT '#4f7cff',
  height_cm     REAL,
  bio           TEXT NOT NULL DEFAULT '',
  api_key_hash  TEXT,                     -- sha256 of the user's API key, if one has been issued
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key_hash);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,           -- sha256 of the session cookie value
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS activities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  type         TEXT NOT NULL DEFAULT 'other',
  duration_min INTEGER,
  distance_km  REAL,
  occurred_at  TEXT NOT NULL,             -- ISO 8601 UTC
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_activities_occurred ON activities(occurred_at);
CREATE INDEX IF NOT EXISTS idx_activities_user ON activities(user_id, occurred_at);

-- One row per person per day: body weight and/or step count.
CREATE TABLE IF NOT EXISTS metrics (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,              -- YYYY-MM-DD (the person's local date)
  weight_kg   REAL,
  steps       INTEGER,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_metrics_date ON metrics(date);
