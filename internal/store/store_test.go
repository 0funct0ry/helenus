package store

import (
	"errors"
	"path/filepath"
	"testing"
)

func open(t *testing.T) (*Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "sub", "h.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s, path
}

func TestOpenWALAndMigrate(t *testing.T) {
	s, path := open(t)
	if m, _ := s.JournalMode(); m != "wal" {
		t.Fatalf("journal mode %q", m)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	// Reopening applies no migration twice.
	s2, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = s2.Close() }()
	var n int
	if err := s2.db.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&n); err != nil || n != 5 {
		t.Fatalf("migrations applied: %d, %v", n, err)
	}
}

func TestChangesLifecycle(t *testing.T) {
	s, path := open(t)
	for _, c := range []Change{
		{Profile: "a", Action: "create", Statement: "CREATE TYPE ks.t (a int)", ObjectName: "t", Status: "ok", Reverse: "DROP TYPE ks.t;"},
		{Profile: "a", Action: "create", Statement: "CREATE TABLE ks.users (id int PRIMARY KEY)", ObjectName: "users", Status: "error", Error: "boom"},
		{Profile: "b", Action: "drop", Statement: "DROP TABLE x.y", Status: "ok"},
	} {
		if _, err := s.AddChange(c); err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.ListChanges("a", 50, 0, "")
	if err != nil || len(got) != 2 || got[0].ObjectName != "users" || got[0].Error != "boom" || got[1].Reverse != "DROP TYPE ks.t;" {
		t.Fatalf("list: %+v, %v", got, err)
	}
	if got, _ = s.ListChanges("a", 1, got[0].ID, ""); len(got) != 1 || got[0].ObjectName != "t" {
		t.Fatalf("paging: %+v", got)
	}
	if got, _ = s.ListChanges("a", 50, 0, "USERS"); len(got) != 1 {
		t.Fatalf("search: %+v", got)
	}
	if got, _ = s.ListChanges("a", 50, 0, "%"); len(got) != 0 {
		t.Fatalf("wildcards must be escaped: %+v", got)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s2, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = s2.Close() }()
	if got, _ = s2.ListChanges("a", 50, 0, ""); len(got) != 2 {
		t.Fatalf("history lost across reopen: %+v", got)
	}
	if n, err := s2.ClearChanges("a"); err != nil || n != 2 {
		t.Fatalf("clear: %d %v", n, err)
	}
	if got, _ = s2.ListChanges("b", 50, 0, ""); len(got) != 1 {
		t.Fatalf("clear must be profile-scoped: %+v", got)
	}
}

func TestSeedProfilesLifecycle(t *testing.T) {
	s, _ := open(t)
	p, err := s.SaveSeedProfile(SeedProfile{Profile: "a", Keyspace: "shop", Table: "users", Name: "big", Config: `{"x":1}`}, false)
	if err != nil || p.ID == 0 || p.Config != `{"x":1}` {
		t.Fatalf("save: %+v, %v", p, err)
	}
	if _, err := s.SaveSeedProfile(SeedProfile{Profile: "a", Keyspace: "shop", Table: "users", Name: "big", Config: `{}`}, false); err != ErrSeedProfileExists {
		t.Fatalf("duplicate err = %v", err)
	}
	p2, err := s.SaveSeedProfile(SeedProfile{Profile: "a", Keyspace: "shop", Table: "users", Name: "big", Config: `{"x":2}`}, true)
	if err != nil || p2.ID != p.ID || p2.Config != `{"x":2}` {
		t.Fatalf("overwrite: %+v, %v", p2, err)
	}
	_, _ = s.SaveSeedProfile(SeedProfile{Profile: "a", Keyspace: "shop", Table: "orders", Name: "o", Config: `{}`}, false)
	list, _ := s.ListSeedProfiles("a", "shop", "users")
	if len(list) != 1 {
		t.Fatalf("list = %d", len(list))
	}
	if _, err := s.GetSeedProfile("b", p.ID); err != ErrSeedProfileNotFound {
		t.Fatalf("cross-profile get err = %v", err)
	}
	if ok, _ := s.DeleteSeedProfile("a", p.ID); !ok {
		t.Fatal("delete failed")
	}
	if ok, _ := s.DeleteSeedProfile("a", p.ID); ok {
		t.Fatal("double delete succeeded")
	}
}

func TestExportPresets(t *testing.T) {
	s, _ := open(t)
	g, err := s.CreateExportPreset(ExportPreset{Name: "Finance", Format: "csv", Options: `{"delimiter":";"}`, Columns: []string{"a", "b"}})
	if err != nil {
		t.Fatal(err)
	}
	if g.Profile != "" || len(g.Columns) != 2 {
		t.Fatalf("%+v", g)
	}
	if _, err := s.CreateExportPreset(ExportPreset{Name: "Finance", Format: "json", Options: "{}"}); !errors.Is(err, ErrExportPresetExists) {
		t.Fatalf("global duplicate: %v", err)
	}
	l, err := s.CreateExportPreset(ExportPreset{Profile: "dev", Name: "Finance", Format: "json", Options: "{}"})
	if err != nil || l.Columns != nil {
		t.Fatalf("%+v %v", l, err)
	}
	if got, _ := s.ListExportPresets("dev"); len(got) != 2 {
		t.Fatalf("dev sees %d", len(got))
	}
	if got, _ := s.ListExportPresets("prod"); len(got) != 1 {
		t.Fatalf("prod sees %d", len(got))
	}
	if _, err := s.GetExportPreset("prod", l.ID); !errors.Is(err, ErrExportPresetNotFound) {
		t.Fatalf("cross-profile get: %v", err)
	}
	u, err := s.UpdateExportPreset("dev", l.ID, ExportPreset{Name: "Fin2", Format: "xml", Options: "{}", Columns: []string{}})
	if err != nil || u.Name != "Fin2" || u.Columns == nil {
		t.Fatalf("%+v %v", u, err)
	}
	if ok, _ := s.DeleteExportPreset("dev", l.ID); !ok {
		t.Fatal("not deleted")
	}
	if ok, _ := s.DeleteExportPreset("dev", l.ID); ok {
		t.Fatal("deleted twice")
	}
}
