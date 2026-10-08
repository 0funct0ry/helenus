package shell

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/0funct0ry/helenus/internal/store"
)

func run(t *testing.T, h *harness, line string) error {
	t.Helper()
	return h.sh.Execute(context.Background(), line)
}

func TestStatementLogAndSave(t *testing.T) {
	h := newHarness(nil)
	dir := t.TempDir()
	if err := run(t, h, ".save "+filepath.Join(dir, "x.cql")); err != nil || !strings.Contains(h.out.String(), "nothing to save") {
		t.Fatalf("%v %q", err, h.out)
	}
	_ = run(t, h, "SELECT 1;")
	_ = run(t, h, "-- c\nSELECT 2")
	_ = run(t, h, "ALTER ROLE x WITH PASSWORD = 'p';")
	_ = run(t, h, ".consistency one")
	if len(h.sh.stmtLog) != 2 {
		t.Fatalf("log %q", h.sh.stmtLog)
	}
	p := filepath.Join(dir, "a b.cql")
	if err := run(t, h, `.save -a "`+p+`"`); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(p)
	if string(b) != "SELECT 1;\n\n-- c\nSELECT 2;\n" {
		t.Fatalf("file %q", b)
	}
	if !strings.Contains(h.out.String(), "Saved 2 statements to ") {
		t.Fatal(h.out.String())
	}
	if err := run(t, h, `.save "`+p+`"`); err == nil || !strings.Contains(err.Error(), "use -f") {
		t.Fatalf("overwrite: %v", err)
	}
	if err := run(t, h, `.save -f -n 1 "`+p+`"`); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(p); string(b) != "-- c\nSELECT 2;\n" {
		t.Fatalf("file %q", b)
	}
	if err := run(t, h, ".save "+filepath.Join(dir, "nope", "x.cql")); err == nil {
		t.Fatal("missing parent accepted")
	}
	if err := run(t, h, ".save -n 1 -a x"); err == nil {
		t.Fatal("-n with -a accepted")
	}
}

func TestOpenRunsAfterEditor(t *testing.T) {
	h := newHarness(nil)
	p := filepath.Join(t.TempDir(), "n.cql")
	edits := 0
	h.sh.Editor = func(path string) error {
		edits++
		return os.WriteFile(path, []byte("USE a;\nSELECT 1;\n"), 0o600)
	}
	answers := []string{"e", "y"}
	h.sh.Ask = func(string) (string, error) { a := answers[0]; answers = answers[1:]; return a, nil }
	if err := run(t, h, ".open "+p); err != nil {
		t.Fatal(err)
	}
	if edits != 2 || len(h.ex.reqs) != 2 || !strings.Contains(h.out.String(), "2 statements in ") {
		t.Fatalf("edits=%d reqs=%d out=%q", edits, len(h.ex.reqs), h.out)
	}
	// Anything but y does not run; a failing editor runs nothing.
	h2 := newHarness(nil)
	h2.sh.Editor = h.sh.Editor
	h2.sh.Ask = func(string) (string, error) { return "", nil }
	_ = run(t, h2, ".open "+p)
	if len(h2.ex.reqs) != 0 {
		t.Fatal("ran without y")
	}
	h2.sh.Editor = func(string) error { return os.ErrInvalid }
	if err := run(t, h2, ".open "+p); err == nil || len(h2.ex.reqs) != 0 {
		t.Fatalf("%v", err)
	}
	// An editor that saves nothing for a missing file is an error line.
	h2.sh.Editor = func(string) error { return nil }
	if err := run(t, h2, ".open "+filepath.Join(t.TempDir(), "missing.cql")); err == nil {
		t.Fatal("missing file accepted")
	}
}

func openLib(t *testing.T, h *harness) {
	t.Helper()
	h.sh.OpenStore = func() (*store.Store, error) {
		return store.Open(filepath.Join(t.TempDir(), "h.db"))
	}
	t.Cleanup(h.sh.CloseLibrary)
}

func TestLibraryCommands(t *testing.T) {
	h := newHarness(nil)
	h.sh.Profile = "dev"
	openLib(t, h)
	_ = run(t, h, "SELECT 1;")
	if err := run(t, h, ".save --db reports/daily"); err != nil {
		t.Fatal(err)
	}
	if err := run(t, h, ".save --db reports/Daily"); err == nil || !strings.Contains(err.Error(), "-f") {
		t.Fatalf("dup: %v", err)
	}
	_ = run(t, h, "SELECT 2;")
	if err := run(t, h, ".save --db -f reports/Daily"); err != nil {
		t.Fatal(err)
	}
	if err := run(t, h, ".save --db --global shared"); err != nil {
		t.Fatal(err)
	}
	h.out.Reset()
	if err := run(t, h, ".queries"); err != nil {
		t.Fatal(err)
	}
	if o := h.out.String(); !strings.Contains(o, "reports/Daily") || !strings.Contains(o, "Global") || !strings.Contains(o, "dev") {
		t.Fatalf("queries: %q", o)
	}
	if err := run(t, h, ".queries zzz"); err != nil || !strings.Contains(h.out.String(), "No saved queries") {
		t.Fatal(h.out.String())
	}
	// .load edits, runs, and saves changes back.
	h.sh.Editor = func(path string) error {
		b, _ := os.ReadFile(path)
		return os.WriteFile(path, append(b, []byte("\nSELECT 3;")...), 0o600)
	}
	answers := []string{"y", "y"}
	h.sh.Ask = func(string) (string, error) { a := answers[0]; answers = answers[1:]; return a, nil }
	before := len(h.ex.reqs)
	if err := run(t, h, ".load reports/daily"); err != nil {
		t.Fatal(err)
	}
	if len(h.ex.reqs)-before != 2 {
		t.Fatalf("ran %d", len(h.ex.reqs)-before)
	}
	l, _ := h.sh.lib()
	q, err := l.FindByName("dev", "reports/daily", false)
	if err != nil || !strings.Contains(q.Text, "SELECT 3;") || q.Version != 3 {
		t.Fatalf("%+v %v", q, err)
	}
	if err := run(t, h, ".load nothing"); err == nil {
		t.Fatal("missing name accepted")
	}
}

func TestLibraryUnavailable(t *testing.T) {
	h := newHarness(nil)
	if err := run(t, h, ".queries"); err == nil || !strings.Contains(err.Error(), "query library unavailable") {
		t.Fatalf("%v", err)
	}
}

func TestPathCompletion(t *testing.T) {
	dir := t.TempDir()
	_ = os.Mkdir(filepath.Join(dir, "sub"), 0o700)
	_ = os.WriteFile(filepath.Join(dir, "scr.cql"), nil, 0o600)
	h := newHarness(nil)
	out, n, ok := h.sh.argCompletion(".source " + dir + "/s")
	if !ok || n != 1 || len(out) != 2 {
		t.Fatalf("%q %d %v", out, n, ok)
	}
	got := []string{string(out[0]), string(out[1])}
	if got[0] != "cr.cql" || got[1] != "ub/" {
		t.Fatalf("%q", got)
	}
	if _, _, ok := h.sh.argCompletion("SELECT"); ok {
		t.Fatal("completed CQL")
	}
}
