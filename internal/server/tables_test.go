package server

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/0funct0ry/helenus/internal/schema"
)

func TestTablesPreview(t *testing.T) {
	e := schemaEnv(t)
	url := "/api/v1/p/local/tables/preview"
	if rec := e.do("POST", url, `{}`); rec.Code != http.StatusConflict {
		t.Fatalf("not connected: %d", rec.Code)
	}
	e.do("POST", "/api/v1/p/local/connect", "")

	plan := func(body string) schema.TablePlan {
		rec := e.do("POST", url, body)
		if rec.Code != 200 {
			t.Fatalf("status %d", rec.Code)
		}
		var p schema.TablePlan
		_ = json.Unmarshal(rec.Body.Bytes(), &p)
		return p
	}
	p := plan(`{"keyspace":"payments","name":"users","columns":[{"name":"id","type":{"name":"uuid"}}],"partition_key":["id"],"clustering":[],"options":{}}`)
	want := "CREATE TABLE payments.users (\n  id uuid,\n  PRIMARY KEY (id)\n);"
	if len(p.Errors) != 0 || p.Statement != want {
		t.Errorf("valid: %+v", p)
	}
	p = plan(`{"keyspace":"payments","name":"t","columns":[],"partition_key":[]}`)
	if p.Statement != "" || len(p.Errors) == 0 || p.Errors[0].Step != 1 {
		t.Errorf("existing: %+v", p)
	}
	if rec := e.do("POST", url, `{bad`); rec.Code != http.StatusBadRequest {
		t.Errorf("malformed: %d", rec.Code)
	}
}
