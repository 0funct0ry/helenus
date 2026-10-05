package server

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/0funct0ry/helenus/internal/exec"
)

const rolesSeed = "profiles:\n  local:\n    hosts: [127.0.0.1]\n    username: me\n    password: topsecret\n"

func rolesEnv(t *testing.T) *env {
	e := newEnv(t, rolesSeed)
	e.fc.queryRes = &exec.Result{
		Columns: []exec.Column{{Name: "role"}, {Name: "super"}, {Name: "login"}, {Name: "options"}},
		Raw:     [][]any{{"me", true, true, map[string]string{}}, {"analyst", false, true, map[string]string{}}},
	}
	e.do("POST", "/api/v1/p/local/connect", "")
	return e
}

func TestRolesPreviewMasksAndApplyNeverLeaks(t *testing.T) {
	e := rolesEnv(t)
	body := `{"action":"create","role":"bob","password":"hunter2hunter2","login":true}`
	rec := e.do("POST", "/api/v1/p/local/roles/preview", body)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "'••••••'") || strings.Contains(rec.Body.String(), "hunter2") {
		t.Fatalf("preview: %d %s", rec.Code, rec.Body)
	}
	e.fc.queries = nil
	rec = e.do("POST", "/api/v1/p/local/roles/apply", body)
	if rec.Code != 200 || strings.Contains(rec.Body.String(), "hunter2") {
		t.Fatalf("apply: %d %s", rec.Code, rec.Body)
	}
	last := e.fc.queries[len(e.fc.queries)-1].CQL
	if !strings.Contains(last, "hunter2hunter2") {
		t.Errorf("real statement not executed: %q", last)
	}
}

func TestRolesApplyRejectsInvalidAndSelfDrop(t *testing.T) {
	e := rolesEnv(t)
	rec := e.do("POST", "/api/v1/p/local/roles/apply", `{"action":"drop","role":"me"}`)
	if rec.Code != 422 || !strings.Contains(rec.Body.String(), "You are signed in as me") {
		t.Fatalf("self drop: %d %s", rec.Code, rec.Body)
	}
}

func TestRolesApplyErrorDoesNotLeakPassword(t *testing.T) {
	e := rolesEnv(t)
	e.fc.queryErr = errString("boom hunter2hunter2")
	e.fc.failOn = 4
	rec := e.do("POST", "/api/v1/p/local/roles/apply", `{"action":"create","role":"bob","password":"hunter2hunter2"}`)
	if strings.Contains(rec.Body.String(), "hunter2") {
		t.Fatalf("leak: %s", rec.Body)
	}
}

type errString string

func (e errString) Error() string { return string(e) }

func TestRolesListAndPermissions(t *testing.T) {
	e := rolesEnv(t)
	rec := e.do("GET", "/api/v1/p/local/roles", "")
	var out rolesResponse
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &out) != nil || !out.AuthEnabled || len(out.Roles) != 2 || out.Connected != "me" {
		t.Fatalf("list: %d %s", rec.Code, rec.Body)
	}
	if len(out.Applicable["table"]) == 0 {
		t.Error("missing applicable map")
	}
	e.fc.queryRes = &exec.Result{
		Columns: []exec.Column{{Name: "role"}, {Name: "resource"}, {Name: "permission"}, {Name: "granted"}},
		Raw:     [][]any{{"analyst", "<keyspace shop>", "SELECT", true}, {"other", "<table a.b>", "MODIFY", true}},
	}
	rec = e.do("GET", "/api/v1/p/local/roles/analyst/permissions", "")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"keyspace":"shop"`) || strings.Contains(rec.Body.String(), "MODIFY") {
		t.Fatalf("perms: %d %s", rec.Code, rec.Body)
	}
}

func TestRolesAuthDisabledAndAstra(t *testing.T) {
	e := newEnv(t, "profiles:\n  local:\n    hosts: [127.0.0.1]\n")
	e.do("POST", "/api/v1/p/local/connect", "")
	rec := e.do("GET", "/api/v1/p/local/roles", "")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"auth_enabled":false`) {
		t.Fatalf("no auth: %d %s", rec.Code, rec.Body)
	}
	a := newEnv(t, "profiles:\n  local:\n    hosts: [127.0.0.1]\n    astra:\n      secure_bundle: /x.zip\n")
	a.do("POST", "/api/v1/p/local/connect", "")
	if rec := a.do("GET", "/api/v1/p/local/roles", ""); rec.Code != 404 {
		t.Fatalf("astra: %d", rec.Code)
	}
}

func TestParseResource(t *testing.T) {
	r := parseResource("<function shop.f(int, map<text, int>)>")
	if r.Kind != "function" || r.Name != "f" || len(r.Signature) != 2 || r.Signature[1] != "map<text, int>" {
		t.Errorf("%+v", r)
	}
	if r := parseResource("<all functions in shop>"); r.Kind != "all_functions_in_keyspace" || r.Keyspace != "shop" {
		t.Errorf("%+v", r)
	}
}
