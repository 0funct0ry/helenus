package server

import (
	"encoding/json"
	"testing"

	"github.com/0funct0ry/helenus/internal/schema"
)

func TestSystemDocs(t *testing.T) {
	e := schemaEnv(t)
	rec := e.do("GET", "/api/v1/system-docs", "")
	var c schema.SystemDocCatalog
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &c) != nil {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if c.Keyspaces["system_auth"].Tables["roles"].Description == "" {
		t.Error("system_auth.roles description missing")
	}
}
