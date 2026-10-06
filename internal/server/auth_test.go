package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/0funct0ry/helenus/internal/auth"
	"github.com/0funct0ry/helenus/internal/store"
)

const testPass = "correct horse battery"

func authRouter(t *testing.T, opts Options) (http.Handler, *store.Store) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "h.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	if err := auth.New(st).CreateUser("alice", testPass); err != nil {
		t.Fatal(err)
	}
	opts.Store, opts.Stderr, opts.Auth = st, io.Discard, true
	opts.Assets = fstest.MapFS{"index.html": {Data: []byte("x")}}
	return NewRouter(opts), st
}

func send(h http.Handler, method, path, body string, cookie *http.Cookie, hdr ...string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func login(t *testing.T, h http.Handler) *http.Cookie {
	t.Helper()
	rec := send(h, "POST", "/api/v1/auth/login", `{"username":"Alice","password":"`+testPass+`"}`, nil)
	if rec.Code != 200 {
		t.Fatalf("login: %d %s", rec.Code, rec.Body)
	}
	for _, c := range rec.Result().Cookies() {
		if c.Name == sessionCookie {
			return c
		}
	}
	t.Fatal("no session cookie")
	return nil
}

func TestAuthMiddlewarePublicAndProtected(t *testing.T) {
	h, _ := authRouter(t, Options{})
	for _, p := range []string{"/healthz", "/api/v1/meta"} {
		if rec := send(h, "GET", p, "", nil); rec.Code != 200 {
			t.Errorf("%s public: %d", p, rec.Code)
		}
	}
	for _, p := range []string{"/api/v1/profiles", "/api/v1/auth/me", "/api/v1/p/local/schema"} {
		rec := send(h, "GET", p, "", nil)
		if rec.Code != 401 || !strings.Contains(rec.Body.String(), `"unauthorized"`) {
			t.Errorf("%s: %d %s", p, rec.Code, rec.Body)
		}
	}
	var meta map[string]any
	_ = json.Unmarshal(send(h, "GET", "/api/v1/meta", "", nil).Body.Bytes(), &meta)
	if meta["auth_enabled"] != true {
		t.Errorf("meta: %v", meta)
	}
	ck := login(t, h)
	if rec := send(h, "GET", "/api/v1/auth/me", "", ck); rec.Code != 200 || !strings.Contains(rec.Body.String(), "alice") {
		t.Errorf("me: %d %s", rec.Code, rec.Body)
	}
	_ = json.Unmarshal(send(h, "GET", "/api/v1/meta", "", ck).Body.Bytes(), &meta)
	if meta["user"] != "alice" {
		t.Errorf("meta user: %v", meta)
	}
}

func TestCookieFlags(t *testing.T) {
	h, _ := authRouter(t, Options{})
	ck := login(t, h)
	if !ck.HttpOnly || ck.SameSite != http.SameSiteStrictMode || ck.Secure {
		t.Errorf("plain http cookie: %+v", ck)
	}
	h2, _ := authRouter(t, Options{TLSCert: "c", TLSKey: "k"})
	if ck := login(t, h2); !ck.Secure {
		t.Errorf("TLS cookie must be Secure: %+v", ck)
	}
}

func TestLoginFailuresAreUniformAndRateLimited(t *testing.T) {
	h, _ := authRouter(t, Options{})
	a := send(h, "POST", "/api/v1/auth/login", `{"username":"alice","password":"nope nope nope"}`, nil)
	b := send(h, "POST", "/api/v1/auth/login", `{"username":"ghost","password":"nope nope nope"}`, nil)
	if a.Code != 401 || a.Body.String() != strings.ReplaceAll(b.Body.String(), "ghost", "alice") || !strings.Contains(a.Body.String(), "Incorrect username or password.") {
		t.Errorf("not uniform: %s / %s", a.Body, b.Body)
	}
	var last int
	for i := 0; i < 5; i++ {
		last = send(h, "POST", "/api/v1/auth/login", `{"username":"alice","password":"nope nope nope"}`, nil).Code
	}
	if last != 429 {
		t.Errorf("expected 429 after 5 attempts, got %d", last)
	}
}

func TestRevocation(t *testing.T) {
	h, st := authRouter(t, Options{})
	ck := login(t, h)
	if err := auth.New(st).SetPassword("alice", "a brand new passphrase"); err != nil {
		t.Fatal(err)
	}
	if rec := send(h, "GET", "/api/v1/auth/me", "", ck); rec.Code != 401 {
		t.Errorf("session survived passwd: %d", rec.Code)
	}
	ck2 := func() *http.Cookie {
		rec := send(h, "POST", "/api/v1/auth/login", `{"username":"alice","password":"a brand new passphrase"}`, nil, "X-Forwarded-For", "9.9.9.9")
		return rec.Result().Cookies()[0]
	}()
	if rec := send(h, "POST", "/api/v1/auth/logout", "", ck2); rec.Code != 204 {
		t.Fatalf("logout: %d", rec.Code)
	}
	if rec := send(h, "GET", "/api/v1/auth/me", "", ck2); rec.Code != 401 {
		t.Errorf("session survived logout: %d", rec.Code)
	}
}

func TestCSRFRules(t *testing.T) {
	h, _ := authRouter(t, Options{})
	ck := login(t, h)
	rec := send(h, "POST", "/api/v1/p/local/connect", "", ck, "Content-Type", "text/plain")
	if rec.Code != 415 {
		t.Errorf("text/plain POST: %d", rec.Code)
	}
	rec = send(h, "POST", "/api/v1/profiles/astra/bundle", "", ck, "Content-Type", "multipart/form-data; boundary=x")
	if rec.Code != 400 {
		t.Errorf("upload without header: %d", rec.Code)
	}
	rec = send(h, "POST", "/api/v1/profiles", "{}", ck, "Content-Type", "multipart/form-data; boundary=x", "X-Helenus-Request", "1")
	if rec.Code != 415 {
		t.Errorf("multipart on a JSON route: %d", rec.Code)
	}
}

func TestUIStatePerUser(t *testing.T) {
	h, st := authRouter(t, Options{})
	ck := login(t, h)
	if rec := send(h, "PUT", "/api/v1/p/local/ui-state", `{"tabs":[{"id":"q1"}]}`, ck); rec.Code != 204 {
		t.Fatalf("put: %d %s", rec.Code, rec.Body)
	}
	rec := send(h, "GET", "/api/v1/p/local/ui-state", "", ck)
	if !strings.Contains(rec.Body.String(), `"q1"`) {
		t.Errorf("get: %s", rec.Body)
	}
	if err := auth.New(st).CreateUser("bob", testPass); err != nil {
		t.Fatal(err)
	}
	rec = send(h, "POST", "/api/v1/auth/login", `{"username":"bob","password":"`+testPass+`"}`, nil)
	bob := rec.Result().Cookies()[0]
	if rec := send(h, "GET", "/api/v1/p/local/ui-state", "", bob); strings.Contains(rec.Body.String(), "q1") {
		t.Errorf("state leaked across users: %s", rec.Body)
	}
}

func TestHostCheckWhenAuthOff(t *testing.T) {
	h := NewRouter(Options{Addr: "127.0.0.1:4042", Stderr: io.Discard, Assets: fstest.MapFS{"index.html": {Data: []byte("x")}}})
	cases := map[string]int{
		"localhost:4042": 200, "127.0.0.1:4042": 200, "[::1]:4042": 200,
		"evil.example:4042": 421, "localhost:9999": 421, "attacker.com": 421,
	}
	for host, want := range cases {
		req := httptest.NewRequest("GET", "/healthz", nil)
		req.Host = host
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Errorf("Host %q: %d, want %d", host, rec.Code, want)
		}
	}
}

func TestBindGuardMatrix(t *testing.T) {
	cases := []struct {
		addr string
		auth bool
		ok   bool
	}{
		{"127.0.0.1:4042", false, true}, {"localhost:4042", false, true}, {"[::1]:4042", false, true},
		{"0.0.0.0:4042", false, false}, {":4042", false, false}, {"192.168.1.5:4042", false, false}, {"myhost:4042", false, false},
		{"0.0.0.0:4042", true, true}, {":4042", true, true}, {"127.0.0.1:4042", true, true},
	}
	for _, c := range cases {
		err := CheckBind(c.addr, c.auth)
		if (err == nil) != c.ok {
			t.Errorf("CheckBind(%q, %v) = %v", c.addr, c.auth, err)
		}
		if err != nil && (!strings.Contains(err.Error(), "--auth") || !strings.Contains(err.Error(), "HELENUS_AUTH=true") ||
			!strings.Contains(err.Error(), "ui.auth.enabled: true") || !strings.Contains(err.Error(), "helenus user add")) {
			t.Errorf("message lacks the fix: %v", err)
		}
	}
	if !InsecureBind("0.0.0.0:1", false) || InsecureBind("0.0.0.0:1", true) || InsecureBind("127.0.0.1:1", false) {
		t.Error("InsecureBind matrix wrong")
	}
}
