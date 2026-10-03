package shell

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const recentBody = "SELECT * FROM {{ .keyspace }}.t WHERE id = {{ arg 0 }} LIMIT {{ arg 1 | default 20 }}"

func TestAliasRecentAcceptance(t *testing.T) {
	h := newHarness(nil)
	h.sh.DefineAlias("recent", recentBody)
	if err := h.run(":recent 7c9e\n:recent 7c9e 5"); err != nil {
		t.Fatal(err)
	}
	want := []string{"SELECT * FROM payments.t WHERE id = 7c9e LIMIT 20", "SELECT * FROM payments.t WHERE id = 7c9e LIMIT 5"}
	for i, w := range want {
		if h.ex.reqs[i].CQL != w {
			t.Errorf("req %d = %q, want %q", i, h.ex.reqs[i].CQL, w)
		}
	}
}

func TestAliasDefineListShowUnalias(t *testing.T) {
	h := newHarness(nil)
	if err := h.run(`.alias hi = SELECT 1` + "\n" + `.alias` + "\n" + `.alias hi`); err != nil {
		t.Fatal(err)
	}
	if got := h.out.String(); !strings.Contains(got, "│ :hi ") || !strings.Contains(got, "hi = SELECT 1") {
		t.Errorf("out = %q", got)
	}
	if err := h.run(`.unalias hi`); err != nil {
		t.Fatal(err)
	}
	if err := h.run(`:hi`); err == nil {
		t.Error("expected unknown alias error")
	}
	if err := h.run(`.unalias hi`); err == nil {
		t.Error("expected error removing missing alias")
	}
}

func TestAliasDryRunDoesNotExecute(t *testing.T) {
	h := newHarness(nil)
	h.sh.DefineAlias("recent", recentBody)
	if err := h.run(`.alias --dry-run :recent 42`); err != nil {
		t.Fatal(err)
	}
	if len(h.ex.reqs) != 0 {
		t.Errorf("executed: %+v", h.ex.reqs)
	}
	if !strings.Contains(h.out.String(), "id = 42 LIMIT 20") {
		t.Errorf("out = %q", h.out.String())
	}
}

func TestSetVariablesAndBuiltins(t *testing.T) {
	h := newHarness(nil)
	h.sh.DefineAlias("v", "SELECT '{{ .who }}' {{ .consistency }} {{ .keyspace }}")
	if err := h.run(`.set who bob` + "\n" + `:v` + "\n" + `.set` + "\n" + `.unset who`); err != nil {
		t.Fatal(err)
	}
	if got := h.ex.reqs[0].CQL; got != "SELECT 'bob' LOCAL_ONE payments" {
		t.Errorf("cql = %q", got)
	}
	if !strings.Contains(h.out.String(), "│ who") && strings.Contains(h.out.String(), "bob") {
		t.Errorf("out = %q", h.out.String())
	}
	if err := h.run(`:v`); err == nil {
		t.Error("expected missing variable error")
	}
}

func TestAliasQuotedArgsAndRecursionCap(t *testing.T) {
	h := newHarness(nil)
	h.sh.DefineAlias("q", "SELECT {{ arg 0 | quote }}")
	h.sh.DefineAlias("loop", ":loop")
	if err := h.run(`:q "it's here"`); err != nil {
		t.Fatal(err)
	}
	if got := h.ex.reqs[0].CQL; got != "SELECT 'it''s here'" {
		t.Errorf("cql = %q", got)
	}
	if err := h.run(`:loop`); err == nil {
		t.Error("expected nesting error")
	}
}

func TestAliasSaveWritesConfig(t *testing.T) {
	h := newHarness(nil)
	p := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(p, []byte("# mine\nshell:\n  paging: 50\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	h.sh.ConfigPath = p
	if err := h.run(`.alias hi = SELECT 1` + "\n" + `.alias --save hi`); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(p)
	for _, w := range []string{"# mine", "paging: 50", "hi: SELECT 1"} {
		if !strings.Contains(string(b), w) {
			t.Errorf("missing %q in %s", w, b)
		}
	}
}

func TestAbbreviationListener(t *testing.T) {
	h := newHarness(nil)
	h.sh.Abbreviations = map[string]string{"sel": "SELECT * FROM "}
	line, pos, ok := h.sh.abbreviationListener([]rune("sel "), 4, ' ')
	if !ok || string(line) != "SELECT * FROM " || pos != len(line) {
		t.Errorf("got %q %d %v", string(line), pos, ok)
	}
	if _, _, ok := h.sh.abbreviationListener([]rune("x sel "), 6, ' '); ok {
		t.Error("expanded mid-statement")
	}
	h.sh.pending = []string{"SELECT"}
	if _, _, ok := h.sh.abbreviationListener([]rune("sel "), 4, ' '); ok {
		t.Error("expanded on continuation line")
	}
}

func TestREPLAbbreviationAndAliasHistory(t *testing.T) {
	h := newHarness(nil)
	hist := filepath.Join(t.TempDir(), "history")
	h.sh.HistoryFile = hist
	h.sh.Abbreviations = map[string]string{"sel": "SELECT * FROM "}
	h.sh.DefineAlias("one", "SELECT 1")
	runREPL(t, h, "sel t;\n", `.alias two = SELECT 2`+"\n", ":one\n", ctrlD)
	if len(h.ex.reqs) != 2 || h.ex.reqs[0].CQL != "SELECT * FROM t;" || h.ex.reqs[1].CQL != "SELECT 1" {
		t.Fatalf("requests = %+v", h.ex.reqs)
	}
	b, _ := os.ReadFile(hist)
	if !strings.Contains(string(b), ":one\nSELECT 1\n") {
		t.Errorf("history = %q", b)
	}
	if h.sh.aliases["two"] != "SELECT 2" {
		t.Errorf("alias two not defined")
	}
}
