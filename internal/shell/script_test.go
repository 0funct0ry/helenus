package shell

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/0funct0ry/helenus/internal/cli"
	"github.com/0funct0ry/helenus/internal/exec"
)

func failOn(substr string) func(exec.Request) (*exec.Result, error) {
	return func(req exec.Request) (*exec.Result, error) {
		if strings.Contains(req.CQL, substr) {
			return nil, errors.New("boom")
		}
		return &exec.Result{Kind: exec.KindVoid}, nil
	}
}

func TestScriptStopsAtFirstError(t *testing.T) {
	h := newHarness(failOn("BAD"))
	err := h.sh.RunScript(context.Background(), "s.cql", "SELECT 1;\nBAD;\nSELECT 2;\n", ScriptOptions{})
	if cli.Code(err) != cli.ExitScript || !errors.Is(err, ErrReported) {
		t.Errorf("err = %v (code %d)", err, cli.Code(err))
	}
	if len(h.ex.reqs) != 2 {
		t.Errorf("requests = %d, want 2", len(h.ex.reqs))
	}
	if got := h.err.String(); !strings.Contains(got, "s.cql:2: Error: boom") {
		t.Errorf("stderr = %q", got)
	}
}

func TestScriptContinueOnError(t *testing.T) {
	h := newHarness(failOn("BAD"))
	err := h.sh.RunScript(context.Background(), "s.cql", "BAD;\nSELECT 2;\nBAD;", ScriptOptions{ContinueOnError: true})
	if cli.Code(err) != cli.ExitCQL {
		t.Errorf("code = %d", cli.Code(err))
	}
	if len(h.ex.reqs) != 3 {
		t.Errorf("requests = %d, want 3", len(h.ex.reqs))
	}
	if !strings.Contains(err.Error(), "2 statements failed") {
		t.Errorf("err = %v", err)
	}
}

func TestExecuteModeUsesCQLExitCode(t *testing.T) {
	h := newHarness(failOn("BAD"))
	err := h.sh.RunScript(context.Background(), "", "BAD", ScriptOptions{AbortCode: cli.ExitCQL})
	if cli.Code(err) != cli.ExitCQL {
		t.Errorf("code = %d", cli.Code(err))
	}
	if !strings.HasPrefix(h.err.String(), "Error: boom") {
		t.Errorf("stderr = %q", h.err)
	}
}

func TestExecuteSeveralStatementsWithoutFinalSemicolon(t *testing.T) {
	h := newHarness(nil)
	if err := h.sh.RunScript(context.Background(), "", "USE a; SELECT 1; SELECT 2", ScriptOptions{}); err != nil {
		t.Fatal(err)
	}
	if len(h.ex.reqs) != 3 {
		t.Errorf("requests = %d", len(h.ex.reqs))
	}
}

func TestScriptEcho(t *testing.T) {
	h := newHarness(nil)
	_ = h.sh.RunScript(context.Background(), "", "-- c\nSELECT 1;\nCONSISTENCY ONE\n", ScriptOptions{Echo: true})
	if got := h.out.String(); !strings.HasPrefix(got, "SELECT 1;\nCONSISTENCY ONE\n") {
		t.Errorf("out = %q", got)
	}
}

func TestScriptExitStopsQuietly(t *testing.T) {
	h := newHarness(nil)
	if err := h.sh.RunScript(context.Background(), "", "SELECT 1;\nEXIT\nSELECT 2;", ScriptOptions{}); err != nil {
		t.Fatal(err)
	}
	if len(h.ex.reqs) != 1 {
		t.Errorf("requests = %d", len(h.ex.reqs))
	}
}

func TestScriptMultiLineStatementsAndBatch(t *testing.T) {
	h := newHarness(nil)
	script := "SELECT a,\n  b\nFROM t;\nBEGIN BATCH\n INSERT INTO t(a) VALUES (1);\n INSERT INTO t(a) VALUES (2);\nAPPLY BATCH;\n"
	if err := h.sh.RunScript(context.Background(), "", script, ScriptOptions{}); err != nil {
		t.Fatal(err)
	}
	if len(h.ex.reqs) != 2 || !strings.HasPrefix(h.ex.reqs[1].CQL, "BEGIN BATCH") {
		t.Errorf("requests = %+v", h.ex.reqs)
	}
}

func TestRawOutputLineCount(t *testing.T) {
	h := newHarness(func(exec.Request) (*exec.Result, error) {
		return rows([2]any{1, "a"}, [2]any{2, nil}, [2]any{3, "c"}), nil
	})
	h.sh.Format = "raw"
	if err := h.sh.RunScript(context.Background(), "", "SELECT * FROM t", ScriptOptions{AbortCode: 1}); err != nil {
		t.Fatal(err)
	}
	if n := strings.Count(h.out.String(), "\n"); n != 4 {
		t.Errorf("lines = %d, want header + 3 rows: %q", n, h.out)
	}
	if !strings.Contains(h.out.String(), "2\t\n") {
		t.Errorf("null not empty: %q", h.out)
	}
}
