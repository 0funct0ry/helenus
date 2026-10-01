package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func testRouter() http.Handler {
	return NewRouter(Options{
		Version: "test",
		Stderr:  io.Discard,
		Assets: fstest.MapFS{
			"index.html":        {Data: []byte("<html>app</html>")},
			"assets/app-abc.js": {Data: []byte("console.log(1)")},
			"favicon.svg":       {Data: []byte("<svg/>")},
		},
	})
}

func get(t *testing.T, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	testRouter().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestHealthz(t *testing.T) {
	if rec := get(t, "/healthz"); rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
}

func TestMeta(t *testing.T) {
	rec := get(t, "/api/v1/meta")
	var body struct {
		Version     string `json:"version"`
		AuthEnabled bool   `json:"auth_enabled"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Version != "test" || body.AuthEnabled {
		t.Fatalf("%+v", body)
	}
}

func TestCacheHeaders(t *testing.T) {
	cases := map[string]string{
		"/":                  cacheNone,
		"/index.html":        cacheNone,
		"/assets/app-abc.js": cacheImmutable,
		"/favicon.svg":       cacheNone,
	}
	for path, want := range cases {
		rec := get(t, path)
		if rec.Code != 200 || rec.Header().Get("Cache-Control") != want {
			t.Errorf("%s: status %d cache %q", path, rec.Code, rec.Header().Get("Cache-Control"))
		}
	}
	if ct := get(t, "/assets/app-abc.js").Header().Get("Content-Type"); ct == "" {
		t.Error("missing content type")
	}
}

func TestSPAFallback(t *testing.T) {
	rec := get(t, "/p/prod/tables/x")
	if rec.Code != 200 || rec.Body.String() != "<html>app</html>" {
		t.Fatalf("status %d body %q", rec.Code, rec.Body.String())
	}
}

func TestUnknownAPIRoute(t *testing.T) {
	rec := get(t, "/api/v1/nope")
	if rec.Code != 404 {
		t.Fatalf("status %d", rec.Code)
	}
	var body struct {
		Error struct{ Code string } `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body.Error.Code != "not_found" {
		t.Fatalf("body %q", rec.Body.String())
	}
}

func TestMissingBuild(t *testing.T) {
	rec := httptest.NewRecorder()
	NewRouter(Options{Stderr: io.Discard, Assets: fstest.MapFS{}}).ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d", rec.Code)
	}
}
