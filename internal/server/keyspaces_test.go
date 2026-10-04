package server

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/0funct0ry/helenus/internal/schema"
)

func TestKeyspacesPreview(t *testing.T) {
	e := schemaEnv(t)
	url := "/api/v1/p/local/keyspaces/preview"
	if rec := e.do("POST", url, `{}`); rec.Code != http.StatusConflict {
		t.Fatalf("not connected: %d", rec.Code)
	}
	e.do("POST", "/api/v1/p/local/connect", "")

	plan := func(body string) schema.KeyspacePlan {
		rec := e.do("POST", url, body)
		if rec.Code != 200 {
			t.Fatalf("status %d", rec.Code)
		}
		var p schema.KeyspacePlan
		_ = json.Unmarshal(rec.Body.Bytes(), &p)
		return p
	}
	p := plan(`{"name":"shop","strategy":"SimpleStrategy","replication_factor":1,"durable_writes":true}`)
	want := "CREATE KEYSPACE shop WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1} AND durable_writes = true;"
	if len(p.Errors) != 0 || p.Statement != want {
		t.Errorf("valid: %+v", p)
	}
	p = plan(`{"name":"payments","strategy":"SimpleStrategy","replication_factor":1,"durable_writes":true}`)
	if p.Statement != "" || len(p.Errors) != 1 || p.Errors[0].Field != "name" {
		t.Errorf("existing: %+v", p)
	}
	if rec := e.do("POST", url, `{bad`); rec.Code != http.StatusBadRequest {
		t.Errorf("malformed: %d", rec.Code)
	}
}
