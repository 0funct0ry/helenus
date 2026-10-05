package server

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/0funct0ry/helenus/internal/schema"
)

func TestViewsPreview(t *testing.T) {
	e := schemaEnv(t)
	url := "/api/v1/p/local/views/preview"
	if rec := e.do("POST", url, `{}`); rec.Code != http.StatusConflict {
		t.Fatalf("not connected: %d", rec.Code)
	}
	e.do("POST", "/api/v1/p/local/connect", "")
	rec := e.do("POST", url, `{"action":"drop","keyspace":"payments","name":"nope"}`)
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	var p schema.TablePlan
	_ = json.Unmarshal(rec.Body.Bytes(), &p)
	if p.Statement != "" || len(p.Errors) == 0 {
		t.Errorf("missing view: %+v", p)
	}
	if rec := e.do("POST", url, `{bad`); rec.Code != http.StatusBadRequest {
		t.Errorf("malformed: %d", rec.Code)
	}
}
