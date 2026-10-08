package library

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/0funct0ry/helenus/internal/store"
)

func newLib(t *testing.T) Library {
	t.Helper()
	s, err := store.Open(filepath.Join(t.TempDir(), "h.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return Library{Store: s}
}

func TestNormalizeName(t *testing.T) {
	good := map[string]string{" a ": "a", "reports/ daily payments ": "reports/daily payments", "x/y/z": "x/y/z", "reports/accounts.cql": "reports/accounts", "A.CQL": "A", "a.cql.cql": "a.cql"}
	for in, want := range good {
		got, err := NormalizeName(in)
		if err != nil || got != want {
			t.Errorf("%q → %q, %v", in, got, err)
		}
	}
	bad := []string{"", "  ", "/a", "a/", "a//b", "a\\b", "a\nb", strings.Repeat("x", 201), "a/ /b", ".cql", "dir/.cql"}
	for _, in := range bad {
		if _, err := NormalizeName(in); !errors.Is(err, ErrInvalidName) {
			t.Errorf("%q accepted: %v", in, err)
		}
	}
}

func TestCreateListScopeAndExists(t *testing.T) {
	l := newLib(t)
	if _, err := l.Create("p", "Daily", "select 1;", false); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Create("p", "daily", "x", false); !errors.Is(err, ErrQueryExists) {
		t.Fatalf("case-insensitive dup: %v", err)
	}
	if _, err := l.Create("p", "daily", "x", true); err != nil {
		t.Fatalf("same name globally: %v", err)
	}
	if _, err := l.Create("other", "only-other", "x", false); err != nil {
		t.Fatal(err)
	}
	got, _ := l.List("p", "")
	if len(got) != 2 || got[0].Global || !got[1].Global || got[0].Text != "" {
		t.Fatalf("list %+v", got)
	}
	if f, _ := l.List("p", "DAI"); len(f) != 2 {
		t.Fatalf("filter %+v", f)
	}
	if _, err := l.Get("other", got[0].ID); !errors.Is(err, ErrQueryNotFound) {
		t.Fatalf("cross-profile get: %v", err)
	}
	if _, err := (Library{Store: l.Store, Owner: 7}).Get("p", got[0].ID); !errors.Is(err, ErrQueryNotFound) {
		t.Fatalf("cross-owner get: %v", err)
	}
}

func TestUpdateVersionAndConflict(t *testing.T) {
	l := newLib(t)
	q, _ := l.Create("p", "a", " keep\r\n ", false)
	if q.Text != " keep\r\n " || q.Version != 1 {
		t.Fatalf("%+v", q)
	}
	u, err := l.Update("p", q.ID, 1, "a", "v2", false)
	if err != nil || u.Version != 2 {
		t.Fatalf("%+v %v", u, err)
	}
	_, err = l.Update("p", q.ID, 1, "a", "stale", false)
	var ce *ConflictError
	if !errors.As(err, &ce) || !errors.Is(err, ErrQueryConflict) || ce.Current.Text != "v2" {
		t.Fatalf("conflict: %v", err)
	}
	if u, err = l.Update("p", q.ID, 0, "a", "forced", false); err != nil || u.Version != 3 {
		t.Fatalf("force %+v %v", u, err)
	}
	if m, err := l.Rename("p", q.ID, 3, "dir/b", true); err != nil || !m.Global || m.Text != "forced" || m.Version != 4 {
		t.Fatalf("move %+v %v", m, err)
	}
	if _, err := l.Update("p", 999, 1, "a", "x", false); !errors.Is(err, ErrQueryNotFound) {
		t.Fatalf("missing: %v", err)
	}
	if _, err := l.Create("p", "big", strings.Repeat("x", MaxTextBytes+1), false); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("large: %v", err)
	}
}

func TestDuplicateDeleteFind(t *testing.T) {
	l := newLib(t)
	q, _ := l.Create("p", "a", "t", false)
	d1, _ := l.Duplicate("p", q.ID)
	d2, _ := l.Duplicate("p", q.ID)
	if d1.Name != "a copy" || d2.Name != "a copy 2" {
		t.Fatalf("%q %q", d1.Name, d2.Name)
	}
	g, _ := l.Create("p", "g", "gt", true)
	if f, err := l.FindByName("p", "G", false); err != nil || f.ID != g.ID || f.Text != "gt" {
		t.Fatalf("%+v %v", f, err)
	}
	if _, err := l.FindByName("p", "a", true); !errors.Is(err, ErrQueryNotFound) {
		t.Fatalf("globalOnly: %v", err)
	}
	if err := l.Delete("p", q.ID); err != nil {
		t.Fatal(err)
	}
	if err := l.Delete("p", q.ID); !errors.Is(err, ErrQueryNotFound) {
		t.Fatalf("%v", err)
	}
}
