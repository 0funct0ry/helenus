CREATE TABLE saved_queries (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NULL REFERENCES users(id),
  profile TEXT NULL,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX saved_queries_name ON saved_queries (COALESCE(user_id, 0), COALESCE(profile, ''), name COLLATE NOCASE);
