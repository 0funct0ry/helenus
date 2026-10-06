CREATE TABLE users (
  id             INTEGER PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,
  token_version  INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  last_login_at  TEXT
);
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE ui_state (
  user_id    INTEGER NOT NULL,
  profile    TEXT NOT NULL,
  state      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, profile)
);
