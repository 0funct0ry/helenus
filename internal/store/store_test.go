package store

import (
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
	if err := s2.db.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&n); err != nil || n != 1 {
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
