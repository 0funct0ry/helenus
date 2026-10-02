package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/0funct0ry/helenus/internal/schema"
)

func schemaEnv(t *testing.T) *env {
	e := newEnv(t, seed)
	e.fc.snap = &schema.Snapshot{Version: "5.0", Keyspaces: []schema.Keyspace{{
		Name:   "payments",
		Tables: []schema.Table{{Keyspace: "payments", Name: "t", Views: []string{"v"}}},
		Views:  []schema.View{{Keyspace: "payments", Name: "v", BaseTable: "t"}},
	}}}
	return e
}

func TestSchemaRequiresConnection(t *testing.T) {
	e := schemaEnv(t)
	for _, req := range [][2]string{{"GET", "/schema"}, {"POST", "/schema/refresh"}, {"GET", "/keyspaces/payments/tables/t"}, {"GET", "/keyspaces/payments/ddl"}} {
		rec := e.do(req[0], "/api/v1/p/local"+req[1], "")
		if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "not_connected") {
			t.Errorf("%v: %d %s", req, rec.Code, rec.Body)
		}
	}
}

func TestSchemaAndRefresh(t *testing.T) {
	e := schemaEnv(t)
	e.do("POST", "/api/v1/p/local/connect", "")
	rec := e.do("GET", "/api/v1/p/local/schema", "")
	var snap schema.Snapshot
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &snap) != nil || snap.Keyspace("payments") == nil {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if rec := e.do("POST", "/api/v1/p/local/schema/refresh", ""); rec.Code != 200 || e.fc.refreshed != 1 {
		t.Fatalf("refresh: %d refreshed=%d", rec.Code, e.fc.refreshed)
	}
	if rec := e.do("GET", "/api/v1/p/nope/schema", ""); rec.Code != 404 {
		t.Errorf("unknown profile: %d", rec.Code)
	}
}

func TestTableDetail(t *testing.T) {
	e := schemaEnv(t)
	e.do("POST", "/api/v1/p/local/connect", "")
	rec := e.do("GET", "/api/v1/p/local/keyspaces/payments/tables/t", "")
	var body struct {
		Table schema.Table  `json:"table"`
		Views []schema.View `json:"views"`
	}
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &body) != nil || body.Table.Name != "t" || len(body.Views) != 1 || body.Views[0].Name != "v" {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	for path, code := range map[string]string{"/keyspaces/nope/tables/t": "keyspace_not_found", "/keyspaces/payments/tables/nope": "table_not_found"} {
		rec := e.do("GET", "/api/v1/p/local"+path, "")
		if rec.Code != 404 || !strings.Contains(rec.Body.String(), code) {
			t.Errorf("%s: %d %s", path, rec.Code, rec.Body)
		}
	}
}

func TestDDL(t *testing.T) {
	e := schemaEnv(t)
	e.do("POST", "/api/v1/p/local/connect", "")
	rec := e.do("GET", "/api/v1/p/local/keyspaces/payments/ddl?object=table&name=t", "")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "CREATE TABLE payments.t") {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	got := e.fc.described[0]
	if got.Kind != schema.TableT || got.Keyspace != "payments" || got.Name != "t" {
		t.Errorf("target = %+v", got)
	}
	e.do("GET", "/api/v1/p/local/keyspaces/payments/ddl", "")
	if k := e.fc.described[1]; k.Kind != schema.KeyspaceT || k.Name != "payments" {
		t.Errorf("keyspace target = %+v", k)
	}
	for _, q := range []string{"?object=bogus", "?object=table"} {
		if rec := e.do("GET", "/api/v1/p/local/keyspaces/payments/ddl"+q, ""); rec.Code != 400 {
			t.Errorf("%s: %d", q, rec.Code)
		}
	}
}
