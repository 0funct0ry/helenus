package server

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/exec"
)

func exportEnv(t *testing.T) *env {
	t.Helper()
	e := seedEnv(t)
	txt, _ := codec.Parse("text", "shop")
	mp, _ := codec.Parse("map<text,int>", "shop")
	e.fc.queryRes = &exec.Result{Kind: exec.KindRows,
		Columns: []exec.Column{{Name: "email", Type: txt}, {Name: "m", Type: mp}},
		Raw:     [][]any{{"a@example.com", codec.Map{Keys: []any{"k"}, Values: []any{1}}}, {"b@example.com", nil}}}
	return e
}

func waitExport(t *testing.T, e *env, id string) (state string, result map[string]any) {
	t.Helper()
	for i := 0; i < 300; i++ {
		var job struct {
			State  string
			Result map[string]any
		}
		_ = json.Unmarshal(e.do("GET", "/api/v1/p/local/jobs/"+id, "").Body.Bytes(), &job)
		if job.State != "running" {
			return job.State, job.Result
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("export did not finish")
	return
}

func TestExportDownloadsOnce(t *testing.T) {
	e := exportEnv(t)
	body := `{"source":{"table":{"keyspace":"shop","table":"users","columns":["email"],"where":"id = 1"}},"format":"csv","options":{"header":true},"filename":"../../out"}`
	rec := e.do("POST", "/api/v1/p/local/export", body)
	var started struct{ ID, Filename string }
	if rec.Code != http.StatusAccepted || json.Unmarshal(rec.Body.Bytes(), &started) != nil {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if started.Filename != "out.csv" {
		t.Fatalf("filename %q", started.Filename)
	}
	if st, res := waitExport(t, e, started.ID); st != "done" || res["rows"].(float64) != 2 {
		t.Fatalf("%s %v", st, res)
	}
	if q := e.fc.queries[0].CQL; q != "SELECT email FROM shop.users WHERE id = 1" {
		t.Fatalf("probe %q", q)
	}
	dl := e.do("GET", "/api/v1/p/local/export/"+started.ID+"/file", "")
	if dl.Code != 200 || !strings.Contains(dl.Header().Get("Content-Disposition"), `filename="out.csv"`) ||
		dl.Body.String() != "email,m\r\na@example.com,{'k': 1}\r\nb@example.com,\r\n" {
		t.Fatalf("%d %v %q", dl.Code, dl.Header(), dl.Body)
	}
	if again := e.do("GET", "/api/v1/p/local/export/"+started.ID+"/file", ""); again.Code != http.StatusGone {
		t.Fatalf("second download: %d", again.Code)
	}
	if left, _ := filepath.Glob(filepath.Join(e.data, "exports", "*")); len(left) != 0 {
		t.Fatalf("temp files left: %v", left)
	}
}

func TestExportValidation(t *testing.T) {
	e := exportEnv(t)
	for name, tc := range map[string]struct {
		body string
		code int
	}{
		"format":     {`{"source":{"query":"SELECT 1"},"format":"yaml"}`, 400},
		"delimiter":  {`{"source":{"query":"SELECT 1"},"format":"csv","options":{"delimiter":"ab"}}`, 422},
		"no source":  {`{"source":{},"format":"csv"}`, 400},
		"not select": {`{"source":{"query":"DROP TABLE x"},"format":"csv"}`, 422},
		"table":      {`{"source":{"table":{"keyspace":"shop","table":"nope"}},"format":"csv"}`, 404},
		"column":     {`{"source":{"table":{"keyspace":"shop","table":"users","columns":["zzz"]}},"format":"csv"}`, 422},
		"ranges+q":   {`{"source":{"query":"SELECT 1"},"format":"csv","ranges":4}`, 422},
	} {
		if rec := e.do("POST", "/api/v1/p/local/export", tc.body); rec.Code != tc.code {
			t.Errorf("%s: %d %s", name, rec.Code, rec.Body)
		}
	}
}

func TestExportFailureLeavesNoFile(t *testing.T) {
	e := exportEnv(t)
	e.fc.queryRes.Raw = [][]any{{"a", nil}}
	e.fc.failOn = 2 // the probe passes, the export itself fails
	e.fc.queryErr = os.ErrClosed
	rec := e.do("POST", "/api/v1/p/local/export", `{"source":{"query":"SELECT * FROM shop.users"},"format":"json"}`)
	var started struct{ ID string }
	_ = json.Unmarshal(rec.Body.Bytes(), &started)
	if st, _ := waitExport(t, e, started.ID); st != "failed" {
		t.Fatalf("state %s", st)
	}
	if left, _ := filepath.Glob(filepath.Join(e.data, "exports", "*")); len(left) != 0 {
		t.Fatalf("partial file kept: %v", left)
	}
	if dl := e.do("GET", "/api/v1/p/local/export/"+started.ID+"/file", ""); dl.Code != http.StatusConflict {
		t.Fatalf("download of failed export: %d", dl.Code)
	}
}

func TestExportPresetsAPI(t *testing.T) {
	e := exportEnv(t)
	url := "/api/v1/p/local/export/presets"
	rec := e.do("POST", url, `{"name":"Finance CSV","format":"csv","options":{"delimiter":";"},"columns":["a","b"]}`)
	var p struct {
		ID      int64
		Columns []string
		Options map[string]string
	}
	if rec.Code != 201 || json.Unmarshal(rec.Body.Bytes(), &p) != nil || p.Options["delimiter"] != ";" || len(p.Columns) != 2 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if rec := e.do("POST", url, `{"name":"Finance CSV","format":"csv"}`); rec.Code != 409 {
		t.Fatalf("duplicate: %d", rec.Code)
	}
	if rec := e.do("POST", url, `{"name":"x","format":"yaml"}`); rec.Code != 400 {
		t.Fatalf("bad format: %d", rec.Code)
	}
	if rec := e.do("GET", url, ""); !strings.Contains(rec.Body.String(), "Finance CSV") {
		t.Fatalf("list: %s", rec.Body)
	}
	id := string(rune('0' + p.ID))
	if rec := e.do("PUT", url+"/"+id, `{"name":"Finance 2","format":"json"}`); rec.Code != 200 || !strings.Contains(rec.Body.String(), "Finance 2") {
		t.Fatalf("update: %d %s", rec.Code, rec.Body)
	}
	if rec := e.do("DELETE", url+"/"+id, ""); rec.Code != 204 {
		t.Fatalf("delete: %d", rec.Code)
	}
	if rec := e.do("DELETE", url+"/"+id, ""); rec.Code != 404 {
		t.Fatalf("delete again: %d", rec.Code)
	}
}

func TestExportFilename(t *testing.T) {
	now := time.Date(2026, 10, 5, 9, 7, 0, 0, time.UTC)
	for in, want := range map[string]string{
		"":            "users-20261005-0907.csv",
		"my:file":     "my_file.csv",
		"data.txt":    "data.txt",
		"/etc/passwd": "passwd.csv",
	} {
		if got := exportFilename(in, "users", "csv", now); got != want {
			t.Errorf("%q → %q, want %q", in, got, want)
		}
	}
}
