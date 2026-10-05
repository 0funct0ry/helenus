CREATE TABLE schema_changes (
  id INTEGER PRIMARY KEY,
  profile TEXT NOT NULL,
  keyspace TEXT,
  object_kind TEXT,
  object_name TEXT,
  action TEXT NOT NULL,
  statement TEXT NOT NULL,
  reverse TEXT,
  reverse_note TEXT,
  status TEXT NOT NULL CHECK (status IN ('ok','error')),
  error TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX schema_changes_profile_created ON schema_changes (profile, created_at);
