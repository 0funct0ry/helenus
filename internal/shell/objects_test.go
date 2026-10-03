package shell

import (
	"context"
	"strings"
	"testing"

	"github.com/0funct0ry/helenus/internal/schema"
)

func objectsHarness() *harness {
	h := newHarness(nil)
	snap := &schema.Snapshot{Keyspaces: []schema.Keyspace{
		{
			Name: "payments",
			Tables: []schema.Table{{
				Name: "txns",
				Columns: []schema.Column{
					{Name: "merchant", Kind: schema.KindPartition},
					{Name: "day", Kind: schema.KindPartition},
					{Name: "ts", Kind: schema.KindClustering},
					{Name: "amount", Kind: schema.KindRegular},
				},
				Triggers: []schema.Trigger{{Name: "audit", Class: "org.example.Audit"}},
				Indexes:  []schema.Index{{Name: "amount_idx", Kind: "COMPOSITES", Target: "amount"}, {Name: "sai_idx", SAI: true, Target: "ts"}},
			}},
			Views:     []schema.View{{Name: "by_day", BaseTable: "txns"}},
			Types:     []schema.UDT{{Name: "address", Fields: []schema.Field{{Name: "street"}, {Name: "city"}}}},
			Functions: []schema.Function{{Name: "plus", ArgTypes: []string{"int", "int"}, ReturnType: "int", Language: "java"}},
		},
		{Name: "empty"},
	}}
	h.sh.Schema = func(context.Context) (*schema.Snapshot, error) { return snap, nil }
	return h
}

func TestListObjectsShowsOnlyCurrentKeyspace(t *testing.T) {
	h := objectsHarness()
	for cmd, want := range map[string][]string{
		".tables":    {"txns", "merchant, day", "ts", "(1 table in payments)"},
		".views":     {"by_day", "txns"},
		".types":     {"address", "street, city"},
		".functions": {"plus(int, int)", "java"},
		".indexes":   {"amount_idx", "SAI", "sai_idx"},
		".triggers":  {"audit", "txns", "org.example.Audit"},
	} {
		h.out.Reset()
		if err := h.sh.Execute(context.Background(), cmd); err != nil {
			t.Fatalf("%s: %v", cmd, err)
		}
		for _, w := range want {
			if !strings.Contains(h.out.String(), w) {
				t.Errorf("%s: missing %q in\n%s", cmd, w, h.out)
			}
		}
		if strings.Contains(h.out.String(), "system") {
			t.Errorf("%s listed other keyspaces:\n%s", cmd, h.out)
		}
	}
}

func TestListObjectsEmptyAndErrors(t *testing.T) {
	h := objectsHarness()
	ctx := context.Background()
	h.sh.Keyspace = "empty"
	_ = h.sh.Execute(ctx, ".aggregates")
	if !strings.Contains(h.out.String(), "No user-defined aggregates in keyspace empty.") {
		t.Errorf("out = %q", h.out)
	}
	h.sh.Keyspace = ""
	err := h.sh.Execute(ctx, ".tables")
	if err == nil || !strings.Contains(err.Error(), "no keyspace selected; run .use <keyspace> first") {
		t.Errorf("err = %v", err)
	}
	h.sh.Keyspace = "gone"
	if err := h.sh.Execute(ctx, ".tables"); err == nil || !strings.Contains(err.Error(), "does not exist") {
		t.Errorf("err = %v", err)
	}
	h.sh.Keyspace = "payments"
	if err := h.sh.Execute(ctx, ".tables extra"); err == nil {
		t.Error("arguments accepted")
	}
}

func TestStyledTableUsesColors(t *testing.T) {
	h := objectsHarness()
	h.sh.Styled = true
	_ = h.sh.Execute(context.Background(), ".tables")
	for _, code := range []string{ansiDim, ansiHeader, ansiNumber} {
		if !strings.Contains(h.out.String(), code) {
			t.Errorf("missing color %q in %q", code, h.out)
		}
	}
	h.out.Reset()
	h.sh.Styled = false
	_ = h.sh.Execute(context.Background(), ".tables")
	if strings.Contains(h.out.String(), "\x1b[") {
		t.Errorf("escape codes in unstyled output: %q", h.out)
	}
}
