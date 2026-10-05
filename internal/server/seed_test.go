package server

import (
	"encoding/json"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/schema"
	"github.com/0funct0ry/helenus/internal/store"
)

func seedCol(name, typ, kind string) schema.Column {
	td, _ := codec.Parse(typ, "shop")
	return schema.Column{Name: name, Type: td, CQL: typ, Kind: kind}
}

func seedEnv(t *testing.T) *env {
	t.Helper()
	e := newEnv(t, seed)
	st, err := store.Open(filepath.Join(t.TempDir(), "h.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	e.h = NewRouter(Options{Stderr: io.Discard, ConfigPath: e.cfg, DataDir: e.data, Connector: e.fc, Store: st,
		Assets: fstest.MapFS{"index.html": {Data: []byte("x")}}})
	e.fc.snap = &schema.Snapshot{Version: "5.0", Keyspaces: []schema.Keyspace{
		{Name: "shop",
			Tables: []schema.Table{{Keyspace: "shop", Name: "users", Columns: []schema.Column{
				seedCol("id", "uuid", schema.KindPartition), seedCol("email", "text", schema.KindRegular),
				seedCol("first_name", "text", schema.KindRegular), seedCol("created", "timestamp", schema.KindRegular)}}},
			Views: []schema.View{{Keyspace: "shop", Name: "by_email", BaseTable: "users"}}},
		{Name: "system", System: true, Tables: []schema.Table{{Keyspace: "system", Name: "local"}}},
	}}
	e.do("POST", "/api/v1/p/local/connect", "")
	return e
}

const usersReq = `{"table":{"keyspace":"shop","table":"users"},"config":%s}`

func req(cfg string) string { return strings.Replace(usersReq, "%s", cfg, 1) }

func TestSeedPreview(t *testing.T) {
	e := seedEnv(t)
	url := "/api/v1/p/local/seed/preview"
	rec := e.do("POST", url, req(`{"seed":42}`))
	var out struct {
		Config    seedConfig       `json:"config"`
		Columns   []map[string]any `json:"columns"`
		Rows      [][]any          `json:"rows"`
		Statement string           `json:"statement"`
		Errors    []map[string]any `json:"errors"`
	}
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &out) != nil {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if len(out.Rows) != 20 || len(out.Columns) != 4 || len(out.Errors) != 0 || !strings.HasPrefix(out.Statement, "INSERT INTO shop.users") {
		t.Fatalf("rows=%d cols=%d errs=%v stmt=%q", len(out.Rows), len(out.Columns), out.Errors, out.Statement)
	}
	if out.Config.Columns["id"].Gen != "uuid" || out.Config.Columns["email"].Params["category"] != "email" ||
		out.Config.Columns["first_name"].Params["category"] != "first_name" || out.Config.Columns["created"].Gen != "time_range" {
		t.Errorf("defaults: %+v", out.Config.Columns)
	}
	// Same seed, same rows.
	again := e.do("POST", url, req(`{"seed":42}`))
	var out2 struct {
		Rows [][]any `json:"rows"`
	}
	_ = json.Unmarshal(again.Body.Bytes(), &out2)
	a, _ := json.Marshal(out.Rows)
	b, _ := json.Marshal(out2.Rows)
	if string(a) != string(b) {
		t.Error("preview is not deterministic")
	}
	for _, r := range out.Rows {
		if em := r[1].(string); !strings.HasSuffix(em, "@example.com") && !strings.HasSuffix(em, "@example.org") && !strings.HasSuffix(em, "@example.net") {
			t.Fatalf("email %q", em)
		}
	}
}

type seedConfig struct {
	Columns map[string]struct {
		Gen    string         `json:"gen"`
		Params map[string]any `json:"params"`
	} `json:"columns"`
}

func TestSeedPreviewFieldErrors(t *testing.T) {
	e := seedEnv(t)
	rec := e.do("POST", "/api/v1/p/local/seed/preview", req(`{"columns":{"email":{"gen":"regex","params":{"pattern":"("}}}}`))
	var out struct {
		Errors []struct{ Field, Message string } `json:"errors"`
		Rows   [][]any                           `json:"rows"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if rec.Code != 200 || len(out.Errors) != 1 || out.Errors[0].Field != "columns.email.params.pattern" || len(out.Rows) != 0 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

func TestSeedRefusals(t *testing.T) {
	e := seedEnv(t)
	for _, tc := range []struct {
		ks, tbl string
		code    int
	}{{"system", "local", 422}, {"shop", "by_email", 422}, {"shop", "nope", 404}, {"nope", "x", 404}} {
		body := `{"table":{"keyspace":"` + tc.ks + `","table":"` + tc.tbl + `"},"config":{}}`
		for _, path := range []string{"preview", "run"} {
			if rec := e.do("POST", "/api/v1/p/local/seed/"+path, body); rec.Code != tc.code {
				t.Errorf("%s %s.%s: %d %s", path, tc.ks, tc.tbl, rec.Code, rec.Body)
			}
		}
	}
	if rec := e.do("POST", "/api/v1/p/local/seed/run", req(`{"total_rows":0,"consistency":"ANY"}`)); rec.Code != 422 || !strings.Contains(rec.Body.String(), "consistency") {
		t.Errorf("invalid run: %d %s", rec.Code, rec.Body)
	}
}

func TestSeedRunAndJobs(t *testing.T) {
	e := seedEnv(t)
	rec := e.do("POST", "/api/v1/p/local/seed/run", req(`{"seed":1,"total_rows":25,"concurrency":1}`))
	var started struct{ ID string }
	if rec.Code != http.StatusAccepted || json.Unmarshal(rec.Body.Bytes(), &started) != nil || started.ID == "" {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	var job struct {
		State    string
		Progress struct{ Done, Total int }
		Result   struct{ Written int }
	}
	for i := 0; i < 200; i++ {
		_ = json.Unmarshal(e.do("GET", "/api/v1/p/local/jobs/"+started.ID, "").Body.Bytes(), &job)
		if job.State != "running" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if job.State != "done" || job.Result.Written != 25 || job.Progress.Done != 25 {
		t.Fatalf("job = %+v", job)
	}
	if len(e.fc.queries) != 25 || !strings.HasPrefix(e.fc.queries[0].CQL, "INSERT INTO shop.users") || e.fc.queries[0].Consistency != "LOCAL_QUORUM" || len(e.fc.queries[0].Args) != 4 {
		t.Fatalf("queries = %d %+v", len(e.fc.queries), e.fc.queries[0])
	}
	if rec := e.do("GET", "/api/v1/p/local/jobs", ""); !strings.Contains(rec.Body.String(), started.ID) {
		t.Errorf("list: %s", rec.Body)
	}
	if rec := e.do("GET", "/api/v1/p/local/jobs/zzz", ""); rec.Code != 404 {
		t.Errorf("unknown job: %d", rec.Code)
	}
	if rec := e.do("DELETE", "/api/v1/p/local/jobs/zzz", ""); rec.Code != 404 {
		t.Errorf("cancel unknown: %d", rec.Code)
	}
}

func TestSeedProfilesCRUD(t *testing.T) {
	e := seedEnv(t)
	base := "/api/v1/p/local/seed/profiles"
	body := `{"keyspace":"shop","table":"users","name":"small","config":{"seed":7,"total_rows":10}}`
	rec := e.do("POST", base, body)
	var saved struct {
		ID     int64
		Name   string
		Config map[string]any
	}
	if rec.Code != 201 || json.Unmarshal(rec.Body.Bytes(), &saved) != nil || saved.Config["seed"] != float64(7) {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if rec := e.do("POST", base, body); rec.Code != 409 || !strings.Contains(rec.Body.String(), "seed_profile_exists") {
		t.Errorf("duplicate: %d %s", rec.Code, rec.Body)
	}
	over := strings.Replace(body, `"total_rows":10`, `"total_rows":11`, 1)
	over = strings.Replace(over, `}}`, `},"overwrite":true}`, 1)
	if rec := e.do("POST", base, over); rec.Code != 201 || !strings.Contains(rec.Body.String(), `"total_rows":11`) {
		t.Errorf("overwrite: %d %s", rec.Code, rec.Body)
	}
	if rec := e.do("GET", base+"?keyspace=shop&table=users", ""); !strings.Contains(rec.Body.String(), `"small"`) {
		t.Errorf("list: %s", rec.Body)
	}
	if rec := e.do("GET", base+"?keyspace=shop&table=other", ""); strings.Contains(rec.Body.String(), `"small"`) {
		t.Errorf("profiles are per table: %s", rec.Body)
	}
	idStr := strconv.FormatInt(saved.ID, 10)
	if rec := e.do("PUT", base+"/"+idStr, `{"config":{"seed":9}}`); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"seed":9`) {
		t.Errorf("update: %d %s", rec.Code, rec.Body)
	}
	if rec := e.do("DELETE", base+"/"+idStr, ""); rec.Code != 204 {
		t.Errorf("delete: %d", rec.Code)
	}
	if rec := e.do("DELETE", base+"/"+idStr, ""); rec.Code != 404 {
		t.Errorf("delete again: %d", rec.Code)
	}
	if rec := e.do("POST", base, `{"keyspace":"shop"}`); rec.Code != 400 {
		t.Errorf("incomplete: %d", rec.Code)
	}
}

func TestSeedPreviewHasNoNullArrays(t *testing.T) {
	e := seedEnv(t)
	rec := e.do("POST", "/api/v1/p/local/seed/preview", req(`{}`))
	var raw map[string]json.RawMessage
	_ = json.Unmarshal(rec.Body.Bytes(), &raw)
	for _, k := range []string{"notes", "errors", "rows", "columns"} {
		if string(raw[k]) == "null" {
			t.Errorf("%s is null", k)
		}
	}
}
