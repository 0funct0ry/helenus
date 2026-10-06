package server

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/0funct0ry/helenus/internal/store"
)

const (
	uuidA = "11111111-1111-4111-8111-111111111111"
	uuidB = "22222222-2222-4222-8222-222222222222"
)

func importUploadReq(e *env, name, content string) *httptest.ResponseRecorder {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("file", name)
	_, _ = io.WriteString(fw, content)
	_ = mw.Close()
	req := httptest.NewRequest("POST", "/api/v1/p/local/import/upload", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("X-Helenus-Request", "1")
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	return rec
}

const (
	semi  = `"format":{"format":"csv","delimiter":";","header":true}`
	comma = `"format":{"format":"csv","delimiter":",","header":true}`
)

func importBody(upload, extra string) string {
	b := `{"upload":"` + upload + `","table":{"keyspace":"shop","table":"users"}`
	if extra != "" {
		b += "," + extra
	}
	return b + "}"
}

func uploadFile(t *testing.T, e *env, name, content string) string {
	t.Helper()
	rec := importUploadReq(e, name, content)
	var out struct{ Upload string }
	if rec.Code != 201 || json.Unmarshal(rec.Body.Bytes(), &out) != nil {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	return out.Upload
}

func TestImportUploadPlanAndAutoMapping(t *testing.T) {
	e := seedEnv(t)
	csv := "Id;E-Mail;firstName;created_at;ignored\n" + uuidA + ";a@x.com;Ann;2024-01-01T00:00:00Z;z\n" + "oops;b@x.com;Bob;nope;z\n"
	rec := importUploadReq(e, "users.csv", csv)
	var up struct {
		Upload string
		Detect map[string]any
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &up)
	if rec.Code != 201 || up.Detect["delimiter"] != ";" {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	rec = e.do("POST", "/api/v1/p/local/import/plan", importBody(up.Upload, semi))
	var plan struct {
		SourceColumns []string `json:"source_columns"`
		Preview       [][]string
		Errors        []string
		Columns       []struct {
			Target, Source, Confidence string
			Failures                   int
		}
	}
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &plan) != nil {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	got := map[string]string{}
	for _, c := range plan.Columns {
		got[c.Target] = c.Source + "/" + c.Confidence
	}
	if got["id"] != "Id/case" || got["email"] != "E-Mail/normalized" || got["first_name"] != "firstName/normalized" || got["created"] != "created_at/fuzzy" {
		t.Fatalf("%v", got)
	}
	if len(plan.Errors) != 0 || len(plan.Preview) != 2 || len(plan.SourceColumns) != 5 {
		t.Fatalf("%+v", plan)
	}
	if plan.Columns[0].Failures != 1 {
		t.Fatalf("id failures: %+v", plan.Columns[0])
	}

	// Unmapping the key column blocks the import.
	rec = e.do("POST", "/api/v1/p/local/import/plan", importBody(up.Upload, semi+`,"mapping":[{"target":"email","source":"E-Mail"}]`))
	if !strings.Contains(rec.Body.String(), "Map a source column to id") {
		t.Fatalf("%s", rec.Body)
	}
	if rec = e.do("POST", "/api/v1/p/local/import/run", importBody(up.Upload, semi+`,"mapping":[{"target":"email","source":"E-Mail"}]`)); rec.Code != 422 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

func TestImportDryRunWritesNothingAndRunReportsErrors(t *testing.T) {
	e := seedEnv(t)
	id := uploadFile(t, e, "u.csv", "id,email\n"+uuidA+",a@x.com\nbad,b@x.com\n"+uuidB+",c@x.com\n")
	before := len(e.fc.queries)
	rec := e.do("POST", "/api/v1/p/local/import/dry-run", importBody(id, comma+`,"rows":10`))
	var dry struct {
		Rows, Valid, Invalid int
		Errors               []struct {
			Line           int
			Column, Reason string
		}
	}
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &dry) != nil || dry.Rows != 3 || dry.Valid != 2 || dry.Invalid != 1 ||
		dry.Errors[0].Line != 3 || dry.Errors[0].Column != "id" {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if len(e.fc.queries) != before {
		t.Fatal("dry run wrote")
	}

	rec = e.do("POST", "/api/v1/p/local/import/run", importBody(id, comma))
	var started struct{ ID string }
	if rec.Code != http.StatusAccepted || json.Unmarshal(rec.Body.Bytes(), &started) != nil {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	var job struct {
		State  string
		Result map[string]any
	}
	for i := 0; i < 300; i++ {
		_ = json.Unmarshal(e.do("GET", "/api/v1/p/local/jobs/"+started.ID, "").Body.Bytes(), &job)
		if job.State != "running" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if job.State != "done" || job.Result["written"].(float64) != 2 || job.Result["rejected"].(float64) != 1 {
		t.Fatalf("%+v", job)
	}
	if len(e.fc.queries) != before+2 || !strings.HasPrefix(e.fc.queries[before].CQL, "INSERT INTO shop.users (id, email) VALUES") {
		t.Fatalf("%+v", e.fc.queries)
	}
	dl := e.do("GET", "/api/v1/p/local/import/"+started.ID+"/errors", "")
	if dl.Code != 200 || !strings.HasPrefix(dl.Body.String(), "line,column,value,reason,record\n3,id,bad,") {
		t.Fatalf("%d %q", dl.Code, dl.Body)
	}
	if rec := e.do("GET", "/api/v1/p/local/import/nope/errors", ""); rec.Code != 404 {
		t.Fatalf("%d", rec.Code)
	}
}

func TestImportRefusals(t *testing.T) {
	e := seedEnv(t)
	id := uploadFile(t, e, "u.csv", "id\n1\n")
	for name, tc := range map[string]struct {
		body string
		code int
	}{
		"view":    {`{"upload":"` + id + `","table":{"keyspace":"shop","table":"by_email"}}`, 422},
		"system":  {`{"upload":"` + id + `","table":{"keyspace":"system","table":"local"}}`, 422},
		"unknown": {`{"upload":"nope","table":{"keyspace":"shop","table":"users"}}`, 404},
		"table":   {`{"upload":"` + id + `","table":{"keyspace":"shop","table":"zzz"}}`, 404},
	} {
		if rec := e.do("POST", "/api/v1/p/local/import/plan", tc.body); rec.Code != tc.code {
			t.Errorf("%s: %d %s", name, rec.Code, rec.Body)
		}
	}
}

func TestImportUploadLimit(t *testing.T) {
	e := seedEnv(t)
	st, _ := store.Open(filepath.Join(t.TempDir(), "h.db"))
	t.Cleanup(func() { st.Close() })
	e.h = NewRouter(Options{ConfigPath: e.cfg, DataDir: e.data, Connector: e.fc, Store: st, MaxUpload: 100,
		Assets: fstest.MapFS{"index.html": {Data: []byte("x")}}})
	rec := importUploadReq(e, "big.csv", strings.Repeat("a,b\n", 100))
	if rec.Code != http.StatusRequestEntityTooLarge || !strings.Contains(rec.Body.String(), "too_large") {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}
