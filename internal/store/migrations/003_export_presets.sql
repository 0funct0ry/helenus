CREATE TABLE export_presets (
  id INTEGER PRIMARY KEY,
  profile TEXT,
  name TEXT NOT NULL,
  format TEXT NOT NULL,
  options TEXT NOT NULL,
  columns TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX export_presets_name ON export_presets (COALESCE(profile, ''), name);
