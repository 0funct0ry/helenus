CREATE TABLE seed_profiles (
  id INTEGER PRIMARY KEY,
  profile TEXT NOT NULL,
  keyspace TEXT NOT NULL,
  table_name TEXT NOT NULL,
  name TEXT NOT NULL,
  config TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (profile, keyspace, table_name, name)
);
