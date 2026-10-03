package shell

import (
	"context"
	"encoding/base64"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ergochat/readline"

	"github.com/0funct0ry/helenus/internal/exec"
)

// The REPL tests drive the real readline editor over an in-process pipe that
// pretends to be a terminal (FuncIsTerminal, no raw mode), so the editor
// receives the bytes a keyboard would send. No pty library is needed.

const (
	ctrlC = "\x03"
	ctrlD = "\x04"
)

// typeKeys feeds keys to the shell one chunk at a time, waiting for the editor
// to consume each so that Ctrl-C and Ctrl-D land on the intended prompt.
func runREPL(t *testing.T, h *harness, chunks ...string) {
	t.Helper()
	pr, pw := io.Pipe()
	h.sh.In = pr
	h.sh.ReadlineConfig = func(c *readline.Config) {
		c.FuncIsTerminal = func() bool { return true }
		c.FuncMakeRaw = func() error { return nil }
		c.FuncExitRaw = func() error { return nil }
		c.FuncGetSize = func() (int, int) { return 100, 40 }
		c.FuncOnWidthChanged = func(func()) {}
	}
	done := make(chan error, 1)
	go func() { done <- h.sh.Run(context.Background()) }()
	go func() {
		for _, c := range chunks {
			_, _ = pw.Write([]byte(c))
			time.Sleep(60 * time.Millisecond)
		}
		_ = pw.Close()
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("REPL did not exit")
	}
}

func TestREPLMultiLineStatementIsOneRequestAndOneHistoryEntry(t *testing.T) {
	h := newHarness(nil)
	hist := filepath.Join(t.TempDir(), "history")
	h.sh.HistoryFile = hist
	runREPL(t, h, "SELECT id,\n", "  name\n", "FROM t;\n", ".consistency QUORUM\n", ctrlD)
	if len(h.ex.reqs) != 1 || h.ex.reqs[0].CQL != "SELECT id,\n  name\nFROM t;" {
		t.Fatalf("requests = %+v", h.ex.reqs)
	}
	if h.sh.Consistency != "QUORUM" {
		t.Errorf("consistency = %s", h.sh.Consistency)
	}
	out := h.out.String()
	if !strings.Contains(out, "helenus:payments> ") || !strings.Contains(out, ContinuationPrompt) {
		t.Errorf("prompts missing in %q", out)
	}
	b, err := os.ReadFile(hist)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	if len(lines) != 2 || lines[0] != "SELECT id, name FROM t;" || lines[1] != ".consistency QUORUM" {
		t.Errorf("history = %q", lines)
	}
}

func TestREPLDoesNotSavePasswordStatements(t *testing.T) {
	h := newHarness(nil)
	hist := filepath.Join(t.TempDir(), "history")
	h.sh.HistoryFile = hist
	runREPL(t, h, "CREATE ROLE bob WITH PASSWORD = 'hunter2' AND LOGIN = true;\n", "SELECT 1;\n", ctrlD)
	if len(h.ex.reqs) != 2 {
		t.Fatalf("requests = %d", len(h.ex.reqs))
	}
	b, _ := os.ReadFile(hist)
	if strings.Contains(strings.ToLower(string(b)), "password") || !strings.Contains(string(b), "SELECT 1;") {
		t.Errorf("history = %q", b)
	}
}

func TestREPLCtrlCDropsPendingInput(t *testing.T) {
	h := newHarness(nil)
	runREPL(t, h, "SELECT partial\n", ctrlC, "SELECT 2;\n", ctrlD)
	if len(h.ex.reqs) != 1 || h.ex.reqs[0].CQL != "SELECT 2;" {
		t.Errorf("requests = %+v", h.ex.reqs)
	}
}

func TestREPLExitAndUseUpdatePrompt(t *testing.T) {
	h := newHarness(func(req exec.Request) (*exec.Result, error) {
		return &exec.Result{Kind: exec.KindVoid, KeyspaceAfter: "ks2"}, nil
	})
	runREPL(t, h, "USE ks2;\n", ".exit\n", "SELECT never;\n")
	if len(h.ex.reqs) != 1 {
		t.Errorf("requests = %d", len(h.ex.reqs))
	}
	if !strings.Contains(h.out.String(), "helenus:ks2> ") {
		t.Errorf("prompt not updated: %q", h.out)
	}
}

func TestREPLErrorsDoNotEndTheSession(t *testing.T) {
	h := newHarness(failOn("BAD"))
	runREPL(t, h, "BAD;\n", "SELECT 1;\n", ctrlD)
	if len(h.ex.reqs) != 2 || !strings.Contains(h.err.String(), "Error: boom") {
		t.Errorf("requests=%d err=%q", len(h.ex.reqs), h.err)
	}
}

func TestREPLMorePrompt(t *testing.T) {
	h := newHarness(func(req exec.Request) (*exec.Result, error) {
		i := 0
		if len(req.PageState) > 0 {
			i = int(req.PageState[0])
		}
		r := rows([2]any{i, "row"})
		r.HasMore = true
		r.PageState = base64.StdEncoding.EncodeToString([]byte{byte(i + 1)})
		return r, nil
	})
	h.sh.Paging = 1
	runREPL(t, h, "SELECT * FROM t;\n", "\n", "q\n", ctrlD)
	if len(h.ex.reqs) != 2 {
		t.Errorf("requests = %d, want 2 (Enter continues, q stops)", len(h.ex.reqs))
	}
	if !strings.Contains(h.out.String(), "--More--") {
		t.Errorf("no --More-- prompt in %q", h.out)
	}
}
