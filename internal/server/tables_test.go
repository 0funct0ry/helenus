package server

import (
	"encoding/json"
	"net/http"
	"strings"
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

func TestPreviewsHaveExplainAndAdvice(t *testing.T) {
	e := schemaEnv(t)
	e.do("POST", "/api/v1/p/local/connect", "")
	rec := e.do("POST", "/api/v1/p/local/tables/preview", `{"keyspace":"payments","name":"readings","columns":[{"name":"sensor","type":{"name":"uuid"}},{"name":"ts","type":{"name":"timestamp"}}],"partition_key":["sensor"],"clustering":[{"column":"ts","order":"DESC"}],"options":{}}`)
	var p schema.TablePlan
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &p) != nil || len(p.Explain) == 0 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	found := false
	for _, n := range p.Notes {
		found = found || len(n) > 4 && n[:4] == "A002"
	}
	if !found || p.Statement == "" {
		t.Errorf("advice must be a note and not block: %+v", p)
	}
	for _, path := range []string{"keyspaces", "types", "indexes", "triggers", "views", "functions", "aggregates"} {
		rec := e.do("POST", "/api/v1/p/local/"+path+"/preview", `{"keyspace":"payments","name":"x","action":"drop"}`)
		var out struct {
			Explain []string `json:"explain"`
		}
		if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &out) != nil || len(out.Explain) == 0 {
			t.Errorf("%s: %d %s", path, rec.Code, rec.Body)
		}
	}
}

func TestAdviseEndpoint(t *testing.T) {
	e := schemaEnv(t)
	url := "/api/v1/p/local/advise?keyspace=payments"
	if rec := e.do("GET", url, ""); rec.Code != http.StatusConflict {
		t.Fatalf("not connected: %d", rec.Code)
	}
	e.do("POST", "/api/v1/p/local/connect", "")
	rec := e.do("GET", url, "")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"findings"`) {
		t.Errorf("%d %s", rec.Code, rec.Body)
	}
	if rec := e.do("GET", "/api/v1/p/local/advise?keyspace=nope", ""); rec.Code != 404 {
		t.Errorf("unknown: %d", rec.Code)
	}
}
