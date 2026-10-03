package shell

import (
	"strings"
	"testing"
	"time"
)

func pin(t *testing.T) {
	t.Helper()
	oldNow, oldU, oldT := nowFn, uuidFn, timeuuidFn
	nowFn = func() time.Time { return time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC) }
	uuidFn = func() string { return "u" }
	timeuuidFn = func() string { return "tu" }
	t.Cleanup(func() { nowFn, uuidFn, timeuuidFn = oldNow, oldU, oldT })
}

func TestTemplateFunctions(t *testing.T) {
	pin(t)
	t.Setenv("HX_TEST", "val")
	data := map[string]any{"keyspace": "ks"}
	cases := []struct{ src, want string }{
		{`{{ .keyspace }}`, "ks"},
		{`{{ arg 0 }}`, "a"},
		{`{{ arg 5 | default 20 }}`, "20"},
		{`{{ arg 1 | default 20 }}`, "b"},
		{`{{ args | join "," }}`, "a,b"},
		{`{{ split "," "x,y" | join "+" }}`, "x+y"},
		{`{{ upper "ab" }}{{ lower "CD" }}`, "ABcd"},
		{`{{ now }}`, "2026-10-03T12:00:00Z"},
		{`{{ today }}`, "2026-10-03"},
		{`{{ ago "24h" }}`, "2026-10-02T12:00:00Z"},
		{`{{ ago "2d" }}`, "2026-10-01T12:00:00Z"},
		{`{{ uuid }}{{ timeuuid }}`, "utu"},
		{`{{ env "HX_TEST" }}`, "val"},
		{`{{ quote "it's" }}`, `'it''s'`},
		{`{{ quote "héllo ✓" }}`, `'héllo ✓'`},
		{`{{ ident "select" }}`, `"select"`},
		{`{{ ident "Order" }}`, `"Order"`},
		{`{{ ident "users" }}`, `users`},
		{`{{ ident "we\"ird" }}`, `"we""ird"`},
		{`{{ ident "café" }}`, `"café"`},
	}
	for _, c := range cases {
		got, err := expandTemplate(c.src, data, []string{"a", "b"})
		if err != nil || got != c.want {
			t.Errorf("%s = %q, %v; want %q", c.src, got, err, c.want)
		}
	}
}

func TestTemplateErrors(t *testing.T) {
	for _, src := range []string{`{{ .nope }}`, `{{ system "ls" }}`, `{{ ago "x" }}`, `{{ `} {
		if _, err := expandTemplate(src, map[string]any{}, nil); err == nil {
			t.Errorf("%s: expected error", src)
		}
	}
}

func TestUUIDShapes(t *testing.T) {
	if u := randomUUID(); len(u) != 36 || u[14] != '4' {
		t.Errorf("uuid = %s", u)
	}
	if u := timeUUID(time.Now()); len(u) != 36 || u[14] != '1' {
		t.Errorf("timeuuid = %s", u)
	}
}

func TestTypedStatementsAreNotTemplated(t *testing.T) {
	h := newHarness(nil)
	if err := h.run("INSERT INTO t (s) VALUES ({{'a': 1}});"); err != nil {
		t.Fatal(err)
	}
	if got := h.ex.reqs[0].CQL; !strings.Contains(got, "{{'a': 1}}") {
		t.Errorf("cql = %q", got)
	}
}
