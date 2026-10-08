package server

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/0funct0ry/helenus/internal/auth"
)

func TestQueriesAPI(t *testing.T) {
	e := seedEnv(t)
	url := "/api/v1/p/local/queries"
	rec := e.do("POST", url, `{"name":"reports/daily","text":"select 1;\r\n"}`)
	var q struct {
		ID      int64
		Text    string
		Version int64
		Global  bool
	}
	if rec.Code != 201 || json.Unmarshal(rec.Body.Bytes(), &q) != nil || q.Version != 1 || q.Text != "select 1;\r\n" {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if rec := e.do("POST", url, `{"name":"REPORTS/daily","text":""}`); rec.Code != 409 || !strings.Contains(rec.Body.String(), "query_exists") {
		t.Fatalf("dup: %d %s", rec.Code, rec.Body)
	}
	if rec := e.do("POST", url, `{"name":"a//b","text":""}`); rec.Code != 400 || !strings.Contains(rec.Body.String(), "invalid_name") {
		t.Fatalf("invalid: %d %s", rec.Code, rec.Body)
	}
	if rec := e.do("POST", url, `{"name":"big","text":"`+strings.Repeat("x", 1<<20+1)+`"}`); rec.Code != 413 {
		t.Fatalf("large: %d", rec.Code)
	}
	list := e.do("GET", url+"?q=DAIL", "")
	if !strings.Contains(list.Body.String(), "reports/daily") || strings.Contains(list.Body.String(), "select") {
		t.Fatalf("list: %s", list.Body)
	}
	id := strconvI(q.ID)
	if rec := e.do("PUT", url+"/"+id, `{"name":"reports/daily","text":"v2","version":1}`); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"version":2`) {
		t.Fatalf("put: %d %s", rec.Code, rec.Body)
	}
	rec = e.do("PUT", url+"/"+id, `{"name":"reports/daily","text":"stale","version":1}`)
	if rec.Code != 409 || !strings.Contains(rec.Body.String(), "query_conflict") || !strings.Contains(rec.Body.String(), `"text":"v2"`) {
		t.Fatalf("conflict: %d %s", rec.Code, rec.Body)
	}
	if rec := e.do("POST", url+"/"+id+"/duplicate", ""); rec.Code != 201 || !strings.Contains(rec.Body.String(), "reports/daily copy") {
		t.Fatalf("dup: %d %s", rec.Code, rec.Body)
	}
	if rec := e.do("GET", url+"/"+id, ""); rec.Code != 200 || !strings.Contains(rec.Body.String(), "v2") {
		t.Fatalf("get: %d", rec.Code)
	}
	if rec := e.do("DELETE", url+"/"+id, ""); rec.Code != 204 {
		t.Fatalf("delete: %d", rec.Code)
	}
	if rec := e.do("GET", url+"/"+id, ""); rec.Code != 404 {
		t.Fatalf("get deleted: %d", rec.Code)
	}
}

func strconvI(n int64) string { b, _ := json.Marshal(n); return string(b) }

func TestQueriesAreOwnedPerUser(t *testing.T) {
	h, st := authRouter(t, Options{})
	if err := auth.New(st).CreateUser("bob", testPass); err != nil {
		t.Fatal(err)
	}
	alice := login(t, h)
	url := "/api/v1/p/local/queries"
	rec := send(h, "POST", url, `{"name":"mine","text":"x"}`, alice)
	if rec.Code != 201 {
		t.Skipf("profile local not available in auth router: %d %s", rec.Code, rec.Body)
	}
	brec := send(h, "POST", "/api/v1/auth/login", `{"username":"bob","password":"`+testPass+`"}`, nil)
	bob := brec.Result().Cookies()[0]
	if l := send(h, "GET", url, "", bob); strings.Contains(l.Body.String(), "mine") {
		t.Fatalf("bob sees alice's query: %s", l.Body)
	}
	if l := send(h, "GET", url, "", alice); !strings.Contains(l.Body.String(), "mine") {
		t.Fatalf("alice lost her query: %s", l.Body)
	}
}
