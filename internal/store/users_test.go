package store

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestUsersSettingsAndUIState(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "h.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = s.Close() }()

	u, err := s.CreateUser("Alice", "hash")
	if err != nil || u.TokenVersion != 1 {
		t.Fatalf("create: %+v %v", u, err)
	}
	if _, err := s.CreateUser("ALICE", "h2"); !errors.Is(err, ErrUserExists) {
		t.Fatalf("case-insensitive uniqueness: %v", err)
	}
	if got, err := s.UserByName("alice"); err != nil || got.ID != u.ID {
		t.Fatalf("lookup: %v", err)
	}
	if err := s.SetPassword("alice", "new"); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.UserByID(u.ID); got.TokenVersion != 2 || got.PasswordHash != "new" {
		t.Fatalf("passwd must bump the version: %+v", got)
	}
	if err := s.SetPassword("ghost", "x"); !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("unknown user: %v", err)
	}

	if v, ok, _ := s.Setting("k"); ok || v != "" {
		t.Fatal("unset setting")
	}
	if v, _ := s.SetSettingIfAbsent("k", "first"); v != "first" {
		t.Fatal(v)
	}
	if v, _ := s.SetSettingIfAbsent("k", "second"); v != "first" {
		t.Fatalf("must not overwrite: %s", v)
	}

	if err := s.PutUIState(u.ID, "local", `{"a":1}`); err != nil {
		t.Fatal(err)
	}
	_ = s.PutUIState(u.ID, "local", `{"a":2}`)
	if v, _ := s.UIState(u.ID, "local"); v != `{"a":2}` {
		t.Fatalf("upsert: %s", v)
	}
	if err := s.DeleteUser("alice"); err != nil {
		t.Fatal(err)
	}
	if v, _ := s.UIState(u.ID, "local"); v != "" {
		t.Fatal("ui_state must go with the user")
	}
	if n, _ := s.CountUsers(); n != 0 {
		t.Fatal(n)
	}
}
