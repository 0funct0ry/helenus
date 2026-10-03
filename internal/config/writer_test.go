package config

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const seed = `# top comment
profiles:
  # the default one
  default:
    hosts: [127.0.0.1]
    port: 9042 # native port
    keyspace: payments

shell:
  # keep me
  format: table
`

func seedFile(t *testing.T) Writer {
	t.Helper()
	p := filepath.Join(t.TempDir(), "sub", "config.yaml")
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(seed), 0o644); err != nil {
		t.Fatal(err)
	}
	return Writer{Path: p}
}

func read(t *testing.T, w Writer) string {
	t.Helper()
	b, err := os.ReadFile(w.Path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func mustContain(t *testing.T, s string, subs ...string) {
	t.Helper()
	for _, sub := range subs {
		if !strings.Contains(s, sub) {
			t.Errorf("missing %q in:\n%s", sub, s)
		}
	}
}

func TestWriterPreservesCommentsAndOrder(t *testing.T) {
	w := seedFile(t)
	if err := w.AddProfile("prod", map[string]any{
		"hosts": []string{"10.0.0.1", "10.0.0.2"}, "tls.enabled": true, "tls.ca_cert": "/ca.pem", "username": "app",
	}); err != nil {
		t.Fatal(err)
	}
	got := read(t, w)
	mustContain(t, got, "# top comment", "# the default one", "# native port", "# keep me", "prod:", "ca_cert: /ca.pem")
	if strings.Index(got, "default:") > strings.Index(got, "prod:") || strings.Index(got, "profiles:") > strings.Index(got, "shell:") {
		t.Errorf("key order changed:\n%s", got)
	}
	if err := w.UpdateProfile("default", map[string]any{"keyspace": "other", "port": nil, "tls.enabled": true}); err != nil {
		t.Fatal(err)
	}
	got = read(t, w)
	mustContain(t, got, "# the default one", "keyspace: other", "# keep me")
	if strings.Contains(got, "port: 9042") {
		t.Errorf("port not removed:\n%s", got)
	}
	if err := w.RemoveProfile("prod"); err != nil {
		t.Fatal(err)
	}
	got = read(t, w)
	if strings.Contains(got, "prod:") {
		t.Errorf("prod not removed:\n%s", got)
	}
	mustContain(t, got, "# top comment", "# the default one", "# keep me", "format: table")
}

func TestWriterMode(t *testing.T) {
	w := seedFile(t)
	if err := w.AddProfile("x", map[string]any{"port": 1}); err != nil {
		t.Fatal(err)
	}
	st, err := os.Stat(w.Path)
	if err != nil {
		t.Fatal(err)
	}
	if st.Mode().Perm() != 0o600 {
		t.Errorf("mode = %v", st.Mode().Perm())
	}
}

func TestWriterErrorsAndNewFile(t *testing.T) {
	w := seedFile(t)
	if err := w.AddProfile("default", nil); !errors.Is(err, ErrProfileExists) {
		t.Errorf("want ErrProfileExists, got %v", err)
	}
	var unknown *UnknownProfileError
	if err := w.RemoveProfile("nope"); !errors.As(err, &unknown) {
		t.Errorf("want UnknownProfileError, got %v", err)
	}
	fresh := Writer{Path: filepath.Join(t.TempDir(), "new", "config.yaml")}
	if err := fresh.AddProfile("a", map[string]any{"hosts": []string{"h"}}); err != nil {
		t.Fatal(err)
	}
	mustContain(t, read(t, fresh), "profiles:", "a:")
}

func TestSetShellEntryKeepsCommentsAndUsesBlockForMultiline(t *testing.T) {
	w := seedFile(t)
	if err := w.SetShellEntry("aliases", "recent", "SELECT *\nFROM t\nLIMIT 5;\n"); err != nil {
		t.Fatal(err)
	}
	if err := w.SetShellEntry("aliases", "one", "SELECT 1"); err != nil {
		t.Fatal(err)
	}
	if err := w.SetShellEntry("aliases", "one", "SELECT 2"); err != nil {
		t.Fatal(err)
	}
	got := read(t, w)
	for _, want := range []string{"# top comment", "# the default one", "# native port", "# keep me", "recent: |", "  SELECT *", "one: SELECT 2"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}
	if strings.Contains(got, "SELECT 1") {
		t.Errorf("old value kept:\n%s", got)
	}
}
