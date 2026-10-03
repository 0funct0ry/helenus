package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/0funct0ry/helenus/internal/schema"
)

func previewType(t *testing.T, e *env, body string) (int, schema.TypePlan) {
	t.Helper()
	rec := e.do("POST", "/api/v1/p/local/types/preview", body)
	var plan schema.TypePlan
	_ = json.Unmarshal(rec.Body.Bytes(), &plan)
	return rec.Code, plan
}

func TestTypesPreview(t *testing.T) {
	e := schemaEnv(t)
	if rec := e.do("POST", "/api/v1/p/local/types/preview", `{}`); rec.Code != http.StatusConflict {
		t.Fatalf("not connected: %d", rec.Code)
	}
	e.do("POST", "/api/v1/p/local/connect", "")

	code, plan := previewType(t, e, `{"action":"create","keyspace":"payments","name":"geo_point","fields":[{"name":"lat","type":{"name":"double"}},{"name":"lon","type":{"name":"double"}}]}`)
	if code != 200 || len(plan.Errors) != 0 || plan.Statement != "CREATE TYPE payments.geo_point (\n    lat double,\n    lon double\n);" {
		t.Errorf("create: %d %+v", code, plan)
	}

	code, plan = previewType(t, e, `{"action":"create","keyspace":"payments","name":"geo_point","fields":[{"name":"lat","type":{"name":"nope"}}]}`)
	if code != 200 || plan.Statement != "" || !strings.Contains(strings.Join(plan.Errors, ";"), "unknown type") {
		t.Errorf("invalid: %d %+v", code, plan)
	}

	if rec := e.do("POST", "/api/v1/p/local/types/preview", `{bad`); rec.Code != http.StatusBadRequest {
		t.Errorf("malformed body: %d", rec.Code)
	}
}
