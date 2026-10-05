package server

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/0funct0ry/helenus/internal/schema"
)

func TestTriggersPreview(t *testing.T) {
	e := schemaEnv(t)
	url := "/api/v1/p/local/triggers/preview"
	if rec := e.do("POST", url, `{}`); rec.Code != http.StatusConflict {
		t.Fatalf("not connected: %d", rec.Code)
	}
	e.do("POST", "/api/v1/p/local/connect", "")
	rec := e.do("POST", url, `{"action":"drop","keyspace":"payments","table":"nope","name":"x"}`)
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	var p schema.TriggerPlan
	_ = json.Unmarshal(rec.Body.Bytes(), &p)
	if p.Statement != "" || len(p.Errors) == 0 {
		t.Errorf("missing table: %+v", p)
	}
	if rec := e.do("POST", url, `{bad`); rec.Code != http.StatusBadRequest {
		t.Errorf("malformed: %d", rec.Code)
	}
}
