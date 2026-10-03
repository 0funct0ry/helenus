package shell

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/0funct0ry/helenus/internal/conn"
	"github.com/0funct0ry/helenus/internal/exec"
)

func TestUseUpdatesKeyspaceAndPrompt(t *testing.T) {
	h := newHarness(func(req exec.Request) (*exec.Result, error) {
		if strings.HasPrefix(strings.ToUpper(req.CQL), "USE") {
			return &exec.Result{Kind: exec.KindVoid, KeyspaceAfter: "analytics"}, nil
		}
		return &exec.Result{Kind: exec.KindVoid}, nil
	})
	if err := h.sh.Execute(context.Background(), "use analytics;"); err != nil {
		t.Fatal(err)
	}
	if h.sh.Keyspace != "analytics" || h.sh.Prompt() != "helenus:analytics> " {
		t.Errorf("keyspace=%q prompt=%q", h.sh.Keyspace, h.sh.Prompt())
	}
	_ = h.sh.Execute(context.Background(), "SELECT 1;")
	if got := h.ex.reqs[1].Keyspace; got != "analytics" {
		t.Errorf("next request keyspace = %q", got)
	}
	// A failing USE keeps the old keyspace.
	h.ex.fn = func(exec.Request) (*exec.Result, error) { return nil, errors.New("Keyspace 'nope' does not exist") }
	if err := h.sh.Execute(context.Background(), "USE nope"); err == nil || h.sh.Keyspace != "analytics" {
		t.Errorf("err=%v keyspace=%q", err, h.sh.Keyspace)
	}
	h.sh.Keyspace = ""
	if h.sh.Prompt() != "helenus> " {
		t.Errorf("prompt = %q", h.sh.Prompt())
	}
}

func TestConsistencyCommands(t *testing.T) {
	h := newHarness(nil)
	ctx := context.Background()
	_ = h.sh.Execute(ctx, ".consistency")
	_ = h.sh.Execute(ctx, ".consistency local_quorum;")
	_ = h.sh.Execute(ctx, ".serial consistency")
	_ = h.sh.Execute(ctx, ".serial consistency local_serial")
	for _, want := range []string{"Current consistency level is LOCAL_ONE.", "Consistency level set to LOCAL_QUORUM.", "Current serial consistency level is SERIAL.", "Serial consistency level set to LOCAL_SERIAL."} {
		if !strings.Contains(h.out.String(), want) {
			t.Errorf("missing %q in %q", want, h.out)
		}
	}
	if h.sh.Consistency != "LOCAL_QUORUM" || h.sh.Serial != "LOCAL_SERIAL" {
		t.Errorf("state = %s %s", h.sh.Consistency, h.sh.Serial)
	}
	if err := h.sh.Execute(ctx, ".consistency bogus"); err == nil || h.sh.Consistency != "LOCAL_QUORUM" {
		t.Errorf("bogus accepted: %v", err)
	}
	if err := h.sh.Execute(ctx, ".serial consistency quorum"); err == nil {
		t.Error("QUORUM accepted as serial consistency")
	}
}

func TestFormatExpandPaging(t *testing.T) {
	h := newHarness(nil)
	ctx := context.Background()
	_ = h.sh.Execute(ctx, ".expand ON")
	if h.sh.Format != "expanded" {
		t.Errorf("format = %s", h.sh.Format)
	}
	_ = h.sh.Execute(ctx, ".expand OFF")
	if h.sh.Format != "table" {
		t.Errorf("format = %s", h.sh.Format)
	}
	_ = h.sh.Execute(ctx, ".format RAW")
	if h.sh.Format != "raw" {
		t.Errorf("format = %s", h.sh.Format)
	}
	if err := h.sh.Execute(ctx, ".format json"); err == nil {
		t.Error("json accepted")
	}
	if err := h.sh.Execute(ctx, ".expand maybe"); err == nil {
		t.Error(".expand maybe accepted")
	}
	_ = h.sh.Execute(ctx, ".paging 25")
	if h.sh.Paging != 25 {
		t.Errorf("paging = %d", h.sh.Paging)
	}
	_ = h.sh.Execute(ctx, ".paging OFF")
	if h.sh.Paging != 0 {
		t.Errorf("paging = %d", h.sh.Paging)
	}
	_ = h.sh.Execute(ctx, ".paging ON")
	if h.sh.Paging != defaultPaging {
		t.Errorf("paging = %d", h.sh.Paging)
	}
	if err := h.sh.Execute(ctx, ".paging -3"); err == nil {
		t.Error("negative paging accepted")
	}
}

func TestSource(t *testing.T) {
	dir := t.TempDir()
	f := filepath.Join(dir, "a.cql")
	if err := os.WriteFile(f, []byte("USE x;\nSELECT 1;\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	h := newHarness(nil)
	if err := h.sh.Execute(context.Background(), ".source '"+f+"'"); err != nil {
		t.Fatal(err)
	}
	if len(h.ex.reqs) != 2 {
		t.Errorf("requests = %d", len(h.ex.reqs))
	}
	if err := h.sh.Execute(context.Background(), ".source '"+filepath.Join(dir, "missing.cql")+"'"); err == nil {
		t.Error("missing file accepted")
	}
	// A script that sources itself stops at the depth limit instead of recursing forever.
	loop := filepath.Join(dir, "loop.cql")
	_ = os.WriteFile(loop, []byte(".source '"+loop+"';\n"), 0o600)
	if err := h.sh.Execute(context.Background(), ".source '"+loop+"'"); err == nil {
		t.Error("recursive SOURCE accepted")
	}
}

func TestHelp(t *testing.T) {
	h := newHarness(nil)
	_ = h.sh.Execute(context.Background(), ".help")
	_ = h.sh.Execute(context.Background(), ".help paging")
	_ = h.sh.Execute(context.Background(), ".help nothing")
	out := h.out.String()
	for _, want := range []string{".consistency [level]", ".paging on|off|<rows>", "--More--", `No help for "nothing"`} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in %q", want, out)
		}
	}
}

func TestClearAndExit(t *testing.T) {
	h := newHarness(nil)
	cleared := false
	h.sh.Clear = func() { cleared = true }
	_ = h.sh.Execute(context.Background(), ".cls")
	if !cleared {
		t.Error(".cls did not clear")
	}
	for _, w := range []string{".exit", ".quit;"} {
		if err := h.sh.Execute(context.Background(), w); !errors.Is(err, ErrExit) {
			t.Errorf("%s: err = %v", w, err)
		}
	}
}

func TestUnknownSlashCommandIsASyntaxError(t *testing.T) {
	h := newHarness(nil)
	err := h.sh.Execute(context.Background(), `.nope`)
	if err == nil || !strings.Contains(err.Error(), "unknown command") {
		t.Errorf("err = %v", err)
	}
	if len(h.ex.reqs) != 0 {
		t.Error("command reached the server")
	}
}

func TestProfileSwitch(t *testing.T) {
	h := newHarness(nil)
	h.sh.Profile = "dev"
	_ = h.sh.Execute(context.Background(), `.profile`)
	if !strings.Contains(h.out.String(), "Current profile is dev.") {
		t.Errorf("out = %q", h.out)
	}
	if err := h.sh.Execute(context.Background(), `.profile prod`); err == nil {
		t.Error("switch without Connect succeeded")
	}
	other := &fakeExec{}
	h.sh.Connect = func(_ context.Context, name string) (*Backend, error) {
		if name == "bad" {
			return nil, errors.New("unknown profile")
		}
		return &Backend{Exec: other, Keyspace: "k", Cluster: &conn.ClusterInfo{Name: "Prod", ReleaseVersion: "4.1.5"}}, nil
	}
	if err := h.sh.Execute(context.Background(), `.profile bad`); err == nil || h.sh.Profile != "dev" {
		t.Errorf("err=%v profile=%s", err, h.sh.Profile)
	}
	if err := h.sh.Execute(context.Background(), `.profile prod`); err != nil {
		t.Fatal(err)
	}
	_ = h.sh.Execute(context.Background(), "SELECT 1;")
	if h.sh.Profile != "prod" || h.sh.Keyspace != "k" || len(other.reqs) != 1 || len(h.ex.reqs) != 0 {
		t.Errorf("profile=%s ks=%s other=%d old=%d", h.sh.Profile, h.sh.Keyspace, len(other.reqs), len(h.ex.reqs))
	}
}

func TestOldMetaFormsAreNowPlainCQL(t *testing.T) {
	h := newHarness(nil)
	for _, in := range []string{"CONSISTENCY QUORUM", "EXIT", `\alias`} {
		_ = h.sh.Execute(context.Background(), in)
	}
	if len(h.ex.reqs) != 3 || h.sh.Consistency != "LOCAL_ONE" {
		t.Errorf("requests = %d, consistency = %s", len(h.ex.reqs), h.sh.Consistency)
	}
}

func TestDotCommandsAreCaseInsensitiveAndUseGoesThroughCQL(t *testing.T) {
	h := newHarness(nil)
	ctx := context.Background()
	if err := h.sh.Execute(ctx, ".Consistency QUORUM"); err != nil || h.sh.Consistency != "QUORUM" {
		t.Errorf("err = %v, consistency = %s", err, h.sh.Consistency)
	}
	if err := h.sh.Execute(ctx, ".USE other"); err != nil || len(h.ex.reqs) != 1 || h.ex.reqs[0].CQL != "USE other" {
		t.Errorf("err = %v, reqs = %+v", err, h.ex.reqs)
	}
	if err := h.sh.Execute(ctx, ".use"); err == nil {
		t.Error(".use without a keyspace accepted")
	}
}
