package server

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/0funct0ry/helenus/internal/config"
	"github.com/0funct0ry/helenus/internal/conn"
	"github.com/0funct0ry/helenus/internal/exec"
	"github.com/0funct0ry/helenus/internal/schema"
)

type fakeConn struct {
	connected map[string]bool
	snap      *schema.Snapshot
	refreshed int
	described []schema.Target
	failWith  error
	lastTest  config.Profile
	queries   []exec.Request
	queryRes  *exec.Result
	queryErr  error
}

func (f *fakeConn) Connect(_ context.Context, name string, _ config.Profile) (*conn.ClusterInfo, []string, error) {
	if f.failWith != nil {
		return nil, nil, f.failWith
	}
	f.connected[name] = true
	return &conn.ClusterInfo{Name: "c", ReleaseVersion: "5.0.2", NodeCount: 3, Datacenters: []string{"dc1"}}, nil, nil
}
func (f *fakeConn) Connected(name string) bool { return f.connected[name] }
func (f *fakeConn) Disconnect(name string)     { delete(f.connected, name) }
func (f *fakeConn) Test(_ context.Context, p config.Profile) *conn.TestResult {
	f.lastTest = p
	if f.failWith != nil {
		return &conn.TestResult{FailedStage: conn.StageAuth, Error: f.failWith.Error(), Stages: []conn.StageResult{{Name: conn.StageAuth, Detail: "bad"}}}
	}
	return &conn.TestResult{OK: true, Stages: []conn.StageResult{{Name: conn.StageAuth, OK: true}}}
}
func (f *fakeConn) Schema(_ context.Context, _ string, _ config.Profile, refresh bool) (*schema.Snapshot, error) {
	if refresh {
		f.refreshed++
	}
	if f.failWith != nil {
		return nil, f.failWith
	}
	return f.snap, nil
}
func (f *fakeConn) Describe(_ context.Context, _ string, _ config.Profile, t schema.Target) (string, error) {
	f.described = append(f.described, t)
	return "CREATE TABLE " + t.Keyspace + "." + t.Name + ";", nil
}
func (f *fakeConn) Query(_ context.Context, _ string, _ config.Profile, req exec.Request) (*exec.Result, error) {
	f.queries = append(f.queries, req)
	return f.queryRes, f.queryErr
}
func (f *fakeConn) CloseAll() {}

type env struct {
	h    http.Handler
	cfg  string
	data string
	fc   *fakeConn
}

func newEnv(t *testing.T, seed string) *env {
	t.Helper()
	dir := t.TempDir()
	e := &env{cfg: filepath.Join(dir, "config.yaml"), data: filepath.Join(dir, "data"), fc: &fakeConn{connected: map[string]bool{}}}
	if seed != "" {
		if err := os.WriteFile(e.cfg, []byte(seed), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	e.h = NewRouter(Options{
		Stderr: io.Discard, ConfigPath: e.cfg, DataDir: e.data, Connector: e.fc,
		Assets: fstest.MapFS{"index.html": {Data: []byte("x")}},
	})
	return e
}

func (e *env) do(method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	return rec
}

const seed = "# keep\nprofiles:\n  local:\n    hosts: [127.0.0.1]\n    username: u\n    password: topsecret\n    astra:\n      token: AstraCS:secrettoken\n"

func TestProfilesNeverLeakSecrets(t *testing.T) {
	e := newEnv(t, seed)
	for _, req := range [][2]string{{"GET", "/api/v1/profiles"}, {"POST", "/api/v1/p/local/connect"}, {"GET", "/api/v1/p/local/cluster"}} {
		rec := e.do(req[0], req[1], "")
		if rec.Code != 200 {
			t.Fatalf("%v: %d %s", req, rec.Code, rec.Body)
		}
		if strings.Contains(rec.Body.String(), "topsecret") || strings.Contains(rec.Body.String(), "secrettoken") {
			t.Fatalf("%v leaked a secret: %s", req, rec.Body)
		}
	}
	var got struct {
		Profiles []map[string]any `json:"profiles"`
	}
	_ = json.Unmarshal(e.do("GET", "/api/v1/profiles", "").Body.Bytes(), &got)
	if len(got.Profiles) != 1 || got.Profiles[0]["password_set"] != true || got.Profiles[0]["token_set"] != true || got.Profiles[0]["connected"] != true {
		t.Fatalf("%v", got.Profiles)
	}
}

func TestCreateUpdateDelete(t *testing.T) {
	e := newEnv(t, seed)
	rec := e.do("POST", "/api/v1/profiles", `{"name":"prod","hosts":["10.0.0.1"],"port":9043,"tls":{"enabled":true,"ca_cert":"/ca.pem"},"password":"pw"}`)
	if rec.Code != 201 || strings.Contains(rec.Body.String(), `"pw"`) {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if e.do("POST", "/api/v1/profiles", `{"name":"prod"}`).Code != 409 {
		t.Fatal("want 409 on duplicate")
	}
	if e.do("POST", "/api/v1/profiles", `{"name":"bad name"}`).Code != 400 {
		t.Fatal("want 400 on bad name")
	}
	if e.do("POST", "/api/v1/profiles", `{"name":"x","bogus":1}`).Code != 400 {
		t.Fatal("want 400 on unknown field")
	}
	// Update without password keeps it; clearing a plain field removes it.
	rec = e.do("PUT", "/api/v1/profiles/prod", `{"keyspace":"ks","port":0,"password":""}`)
	if rec.Code != 200 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	p, err := config.LoadProfile(e.cfg, "prod")
	if err != nil || p.Password != "pw" || p.Keyspace != "ks" || p.Port != 9042 {
		t.Fatalf("%+v %v", p, err)
	}
	b, _ := os.ReadFile(e.cfg)
	if !strings.Contains(string(b), "# keep") {
		t.Fatalf("comment lost:\n%s", b)
	}
	e.fc.connected["prod"] = true
	if rec = e.do("DELETE", "/api/v1/profiles/prod", ""); rec.Code != 204 || e.fc.connected["prod"] {
		t.Fatalf("%d connected=%v", rec.Code, e.fc.connected["prod"])
	}
	if e.do("DELETE", "/api/v1/profiles/prod", "").Code != 404 {
		t.Fatal("want 404")
	}
}

func TestTestEndpoints(t *testing.T) {
	e := newEnv(t, seed)
	rec := e.do("POST", "/api/v1/profiles/test", `{"hosts":["h1"],"username":"x","password":"y"}`)
	if rec.Code != 200 || e.fc.lastTest.Hosts[0] != "h1" || e.fc.lastTest.Password != "y" {
		t.Fatalf("%d %+v", rec.Code, e.fc.lastTest)
	}
	e.do("POST", "/api/v1/profiles/local/test", `{"keyspace":"k"}`)
	if e.fc.lastTest.Password != "topsecret" || e.fc.lastTest.Keyspace != "k" {
		t.Fatalf("saved secret not reused: %+v", e.fc.lastTest)
	}
	if e.do("POST", "/api/v1/profiles/nope/test", "{}").Code != 404 {
		t.Fatal("want 404")
	}
}

func TestConnectFailureReportsStage(t *testing.T) {
	e := newEnv(t, seed)
	e.fc.failWith = errors.New("bad credentials")
	rec := e.do("POST", "/api/v1/p/local/connect", "")
	if rec.Code != 502 || !strings.Contains(rec.Body.String(), `"failed_stage":"auth"`) || !strings.Contains(rec.Body.String(), "connection_failed") {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if e.do("POST", "/api/v1/p/zzz/connect", "").Code != 404 {
		t.Fatal("want 404")
	}
	if e.do("GET", "/api/v1/p/local/cluster", "").Code != 409 {
		t.Fatal("want 409 when not connected")
	}
	if e.do("DELETE", "/api/v1/p/local/connect", "").Code != 204 {
		t.Fatal("want 204")
	}
}

func bundleZip(t *testing.T, files ...string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, f := range files {
		w, _ := zw.Create(f)
		if f == "config.json" {
			_, _ = w.Write([]byte(`{"host":"h","port":443,"keyspace":"ks","localDC":"dc"}`))
		} else {
			_, _ = w.Write([]byte("x"))
		}
	}
	zw.Close()
	return buf.Bytes()
}

func upload(e *env, name string, data []byte) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("bundle", name)
	_, _ = fw.Write(data)
	mw.Close()
	req := httptest.NewRequest("POST", "/api/v1/profiles/astra/bundle", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	return rec
}

func TestBundleUpload(t *testing.T) {
	e := newEnv(t, "")
	if rec := upload(e, "bad.zip", bundleZip(t, "config.json")); rec.Code != 400 {
		t.Fatalf("incomplete bundle: %d %s", rec.Code, rec.Body)
	}
	rec := upload(e, "../../secure-connect-dev.zip", bundleZip(t, "config.json", "ca.crt", "cert", "key"))
	if rec.Code != 200 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	var got struct{ Path string }
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if filepath.Dir(got.Path) != filepath.Join(e.data, "bundles") {
		t.Fatalf("path escaped: %s", got.Path)
	}
	st, err := os.Stat(got.Path)
	if err != nil || st.Mode().Perm() != 0o600 {
		t.Fatalf("%v %v", st, err)
	}
}
