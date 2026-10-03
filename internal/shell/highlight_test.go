package shell

import (
	"context"
	"strings"
	"testing"
)

func TestHighlightCQL(t *testing.T) {
	src := "SELECT id, 'it''s' FROM \"My\".t WHERE n = 42 AND ok = true -- note\nLIMIT {{ arg 0 }};"
	got := highlightCQL(src, true)
	for _, want := range []string{
		paint(ansiKeyword, "SELECT", true), paint(ansiString, "'it''s'", true), paint(ansiQuoted, `"My"`, true),
		paint(ansiNumber, "42", true), paint(ansiLiteral, "true", true), paint(ansiComment, "-- note", true),
		paint(ansiTemplate, "{{ arg 0 }}", true),
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in %q", want, got)
		}
	}
	if highlightCQL(src, false) != src {
		t.Error("unstyled text changed")
	}
	if strip(got) != src {
		t.Errorf("highlighting changed the text: %q", strip(got))
	}
}

func TestHighlightTypesAndUnterminated(t *testing.T) {
	got := highlightCQL("CREATE TABLE t (a text, b list<int>, c 'oops", true)
	if !strings.Contains(got, paint(ansiType, "text", true)) || !strings.Contains(got, paint(ansiType, "int", true)) {
		t.Errorf("types not colored: %q", got)
	}
	if strip(got) != "CREATE TABLE t (a text, b list<int>, c 'oops" {
		t.Errorf("text changed: %q", strip(got))
	}
}

// strip removes ANSI escape sequences.
func strip(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == 0x1b {
			for i < len(s) && s[i] != 'm' {
				i++
			}
			continue
		}
		b.WriteByte(s[i])
	}
	return b.String()
}

func describeHarness() *harness {
	h := objectsHarness()
	snap, _ := h.sh.Schema(context.Background())
	snap.Keyspaces[0].Replication = map[string]string{"class": "org.apache.cassandra.locator.SimpleStrategy", "replication_factor": "3"}
	snap.Keyspaces[0].DurableWrites = true
	h.sh.Describer = &fakeDescriber{}
	return h
}

func TestDescribeListsArePrintedAsTables(t *testing.T) {
	h := describeHarness()
	ctx := context.Background()
	for in, want := range map[string][]string{
		".desc keyspaces":  {"│ keyspace", "replication", "payments", "Simple · 3", "(2 keyspaces)"},
		".desc tables":     {"│ keyspace", "txns", "table", "by_day", "view", "(2 tables)"},
		".desc types":      {"address", "street, city", "(1 type)"},
		".desc functions":  {"plus(int, int)", "java"},
		".desc aggregates": {"No aggregates."},
	} {
		h.out.Reset()
		if err := h.sh.Execute(ctx, in); err != nil {
			t.Fatalf("%s: %v", in, err)
		}
		for _, w := range want {
			if !strings.Contains(h.out.String(), w) {
				t.Errorf("%s: missing %q in\n%s", in, w, h.out)
			}
		}
	}
}

func TestDescribeDDLIsHighlightedAndClusterIsATable(t *testing.T) {
	h := describeHarness()
	h.sh.Styled = true
	h.sh.Describer = &fakeDescriber{out: "\nCREATE TABLE ks.t (id int PRIMARY KEY);\n"}
	if err := h.sh.Execute(context.Background(), ".describe table t"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(h.out.String(), paint(ansiKeyword, "CREATE", true)) || !strings.Contains(h.out.String(), paint(ansiType, "int", true)) {
		t.Errorf("DDL not highlighted: %q", h.out)
	}
	h.out.Reset()
	h.sh.Styled = false
	h.sh.Describer = &fakeDescriber{out: "\nCluster: Test\nPartitioner: Murmur3\n\n"}
	_ = h.sh.Execute(context.Background(), ".describe cluster")
	for _, w := range []string{"│ property", "Partitioner", "Murmur3"} {
		if !strings.Contains(h.out.String(), w) {
			t.Errorf("cluster: missing %q in %s", w, h.out)
		}
	}
}

func TestShowHelpAndAliasListsAreTables(t *testing.T) {
	h := describeHarness()
	ctx := context.Background()
	h.sh.DefineAlias("hi", "SELECT 1")
	h.sh.Styled = true
	for _, in := range []string{".show version", ".show host", ".help", ".alias"} {
		h.out.Reset()
		if err := h.sh.Execute(ctx, in); err != nil {
			t.Fatalf("%s: %v", in, err)
		}
		if !strings.Contains(h.out.String(), "┌") || !strings.Contains(h.out.String(), ansiHeader) {
			t.Errorf("%s is not a colored table:\n%s", in, h.out)
		}
	}
	if !strings.Contains(h.out.String(), paint(ansiKeyword, "SELECT", true)) {
		t.Errorf("alias body not highlighted: %q", h.out)
	}
}

func TestStyledExpandedOutput(t *testing.T) {
	h := newHarness(nil)
	h.sh.Styled = true
	h.sh.Format = "expanded"
	h.ex.fn = nil
	var b strings.Builder
	cols := rows([2]any{1, "x"}).Columns
	RenderExpandedStyled(&b, cols, [][]Cell{{{Text: "1"}, {Text: "x"}}}, 0, true)
	for _, w := range []string{ansiDim, ansiHeader, ansiNumber} {
		if !strings.Contains(b.String(), w) {
			t.Errorf("missing %q in %q", w, b.String())
		}
	}
}
