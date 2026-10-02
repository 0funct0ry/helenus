package server

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/0funct0ry/helenus/internal/complete"
	"github.com/0funct0ry/helenus/internal/schema"
)

func completeEnv(t *testing.T) *env {
	e := schemaEnv(t)
	e.fc.snap = &schema.Snapshot{Keyspaces: []schema.Keyspace{{
		Name: "payments",
		Tables: []schema.Table{{Keyspace: "payments", Name: "t", Columns: []schema.Column{
			{Name: "id", CQL: "uuid", Kind: schema.KindPartition, Position: 1},
			{Name: "v", CQL: "text", Kind: schema.KindRegular},
		}}},
	}}}
	return e
}

func doComplete(t *testing.T, e *env, body string) complete.Result {
	t.Helper()
	rec := e.do("POST", "/api/v1/p/local/complete", body)
	var res complete.Result
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &res) != nil {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	return res
}

func TestCompleteUsesCachedSnapshot(t *testing.T) {
	e := completeEnv(t)
	e.do("POST", "/api/v1/p/local/connect", "")
	res := doComplete(t, e, `{"text":"SELECT * FROM payments.t WHERE ","cursor":33,"keyspace":"payments"}`)
	if len(res.Items) < 2 || res.Items[0].Label != "id" || res.Items[1].Label != "v" || res.Items[0].Key != "partition" {
		t.Fatalf("%+v", res.Items)
	}
	if e.fc.refreshed != 0 {
		t.Error("completion must not refresh the schema")
	}
}

func TestCompleteNotConnectedFallsBackToKeywords(t *testing.T) {
	e := completeEnv(t)
	res := doComplete(t, e, `{"text":"sel","cursor":3}`)
	if len(res.Items) != 1 || res.Items[0].Label != "SELECT" {
		t.Fatalf("%+v", res.Items)
	}
}

func TestCompleteUTF16Offsets(t *testing.T) {
	e := completeEnv(t)
	// "é" is 2 bytes but 1 UTF-16 unit and "😀" is 4 bytes and 2 units.
	res := doComplete(t, e, `{"text":"-- é 😀\nsel","cursor":11}`)
	if res.From != 8 || len(res.Items) != 1 {
		t.Fatalf("from=%d items=%+v", res.From, res.Items)
	}
}

func TestCompleteErrors(t *testing.T) {
	e := completeEnv(t)
	if rec := e.do("POST", "/api/v1/p/nope/complete", `{}`); rec.Code != 404 {
		t.Errorf("unknown profile: %d", rec.Code)
	}
	if rec := e.do("POST", "/api/v1/p/local/complete", `{`); rec.Code != 400 || !strings.Contains(rec.Body.String(), "bad_request") {
		t.Errorf("bad body: %d %s", rec.Code, rec.Body)
	}
}
