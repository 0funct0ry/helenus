package shell

import (
	"context"
	"strings"
	"testing"

	"github.com/0funct0ry/helenus/internal/schema"
)

func completionSnapshot() *schema.Snapshot {
	return &schema.Snapshot{Keyspaces: []schema.Keyspace{{
		Name: "payments",
		Tables: []schema.Table{{Keyspace: "payments", Name: "transactions_by_merchant", Columns: []schema.Column{
			{Name: "merchant_id", CQL: "uuid", Kind: schema.KindPartition, Position: 1},
			{Name: "txn_day", CQL: "date", Kind: schema.KindPartition, Position: 2},
			{Name: "txn_time", CQL: "timeuuid", Kind: schema.KindClustering, Position: 1},
			{Name: "amount", CQL: "decimal", Kind: schema.KindRegular},
		}}},
	}}}
}

func withSchema(h *harness) {
	h.sh.Schema = func(context.Context) (*schema.Snapshot, error) { return completionSnapshot(), nil }
}

func doTab(c completer, line string) (suffixes []string, prefixLen int) {
	cands, n := c.Do([]rune(line), len([]rune(line)))
	for _, r := range cands {
		suffixes = append(suffixes, string(r))
	}
	return suffixes, n
}

func TestCompleterReturnsSuffixesAfterTheWord(t *testing.T) {
	h := newHarness(nil)
	withSchema(h)
	c := completer{h.sh}
	got, n := doTab(c, "SELECT * FROM payments.trans")
	if n != 5 || len(got) != 1 || got[0] != "actions_by_merchant" {
		t.Errorf("table: %q %d", got, n)
	}
	got, _ = doTab(c, "SELECT * FROM payments.transactions_by_merchant WHERE ")
	if strings.Join(got, ",") != "merchant_id,txn_day,txn_time,amount,token()" && !strings.HasPrefix(strings.Join(got, ","), "merchant_id,txn_day,txn_time") {
		t.Errorf("where: %q", got)
	}
	got, _ = doTab(c, "CONSISTENCY ")
	if len(got) != 9 || got[0] != "ANY" || got[8] != "LOCAL_ONE" {
		t.Errorf("consistency: %q", got)
	}
}

func TestCompleterKeywordCaseFollowsTyping(t *testing.T) {
	h := newHarness(nil)
	c := completer{h.sh}
	if got, _ := doTab(c, "sel"); len(got) != 1 || got[0] != "ect" {
		t.Errorf("lower: %q", got)
	}
	if got, _ := doTab(c, "SEL"); len(got) != 1 || got[0] != "ECT" {
		t.Errorf("upper: %q", got)
	}
	if got, _ := doTab(c, "select * from t "); got[0] != "where" {
		t.Errorf("after lower-case word: %q", got)
	}
}

func TestCompleterSeesEarlierLinesOfTheStatement(t *testing.T) {
	h := newHarness(nil)
	withSchema(h)
	h.sh.pending = []string{"SELECT *", "FROM payments.transactions_by_merchant"}
	got, _ := doTab(completer{h.sh}, "WHERE ")
	if len(got) < 3 || got[0] != "merchant_id" {
		t.Errorf("%q", got)
	}
}

func TestCompleterWithoutSchemaOffersKeywords(t *testing.T) {
	h := newHarness(nil)
	got, _ := doTab(completer{h.sh}, "DEL")
	if len(got) != 1 || got[0] != "ETE" {
		t.Errorf("%q", got)
	}
	if got, _ := doTab(completer{h.sh}, "SELECT * FROM "); len(got) != 0 {
		t.Errorf("no snapshot should offer no objects: %q", got)
	}
}

func TestREPLTabCompletesConsistencyLevel(t *testing.T) {
	h := newHarness(nil)
	runREPL(t, h, "CONSISTENCY LOCAL_O\t", "\n", ctrlD)
	if h.sh.Consistency != "LOCAL_ONE" {
		t.Errorf("consistency = %q; output %q", h.sh.Consistency, h.out)
	}
}

func TestREPLTabListsWhereColumns(t *testing.T) {
	h := newHarness(nil)
	withSchema(h)
	runREPL(t, h, "SELECT * FROM payments.transactions_by_merchant WHERE \t", ctrlC, ctrlD)
	out := h.out.String()
	i, j, k := strings.Index(out, "merchant_id"), strings.Index(out, "txn_day"), strings.Index(out, "txn_time")
	if i < 0 || j < i || k < j {
		t.Errorf("candidate list missing or out of order: %q", out)
	}
}
