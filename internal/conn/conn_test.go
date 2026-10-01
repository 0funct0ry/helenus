package conn

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/0funct0ry/helenus/internal/config"
)

func TestClusterConfig(t *testing.T) {
	p := config.Profile{
		Hosts: []string{"a", "b"}, Port: 9100, Keyspace: "ks", Consistency: "LOCAL_QUORUM",
		Username: "u", Password: "p", DC: "dc1", ConnectTimeout: "2s", RequestTimeout: "3s",
		TLS: config.TLS{Enabled: true, InsecureSkipVerify: true},
	}
	b, err := ClusterConfig(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	c := b.Cluster
	if c.Port != 9100 || c.Keyspace != "ks" || c.ConnectTimeout != 2*time.Second || c.Timeout != 3*time.Second || c.Authenticator == nil || c.SslOpts == nil {
		t.Fatalf("%+v", c)
	}
	if len(b.Warnings) != 1 || b.Warnings[0] != InsecureWarning {
		t.Fatalf("warnings = %v", b.Warnings)
	}
	if _, err := ClusterConfig(context.Background(), config.Profile{Consistency: "BOGUS"}); err == nil {
		t.Fatal("want consistency error")
	}
	if _, err := ClusterConfig(context.Background(), config.Profile{TLS: config.TLS{Enabled: true, Cert: "x"}}); err == nil {
		t.Fatal("want cert/key pair error")
	}
}

func TestTestStages(t *testing.T) {
	ctx := context.Background()
	res := Test(ctx, config.Profile{Hosts: []string{"nonexistent.invalid"}, Port: 9042, ConnectTimeout: "2s"})
	if res.OK || res.FailedStage != StageDNS {
		t.Fatalf("dns: %+v", res)
	}

	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	res = Test(ctx, config.Profile{Hosts: []string{"127.0.0.1"}, Port: port, ConnectTimeout: "2s"})
	if res.OK || res.FailedStage != StageTCP {
		t.Fatalf("tcp: %+v", res)
	}

	srv := httptest.NewTLSServer(http.NotFoundHandler())
	defer srv.Close()
	_, ps, _ := net.SplitHostPort(srv.Listener.Addr().String())
	port, _ = strconv.Atoi(ps)
	ca := filepath.Join(t.TempDir(), "other-ca.pem")
	if err := os.WriteFile(ca, unrelatedCAPEM(), 0o600); err != nil {
		t.Fatal(err)
	}
	res = Test(ctx, config.Profile{
		Hosts: []string{"127.0.0.1"}, Port: port, ConnectTimeout: "2s",
		TLS: config.TLS{Enabled: true, CACert: ca},
	})
	if res.OK || res.FailedStage != StageTLS || res.Error == "" {
		t.Fatalf("tls: %+v", res)
	}
}

func TestClassifySessionError(t *testing.T) {
	cases := map[string]string{
		"gocql: Provided username u and/or password are incorrect": StageAuth,
		"Bad credentials":                     StageAuth,
		"unable to discover protocol version": StageProtocol,
	}
	for msg, want := range cases {
		if got := ClassifySessionError(&strErr{msg}); got != want {
			t.Errorf("%q: got %s want %s", msg, got, want)
		}
	}
}

type strErr struct{ s string }

func (e *strErr) Error() string { return e.s }

func TestManagerCloseUnknown(t *testing.T) {
	m := NewManager()
	m.Close("nope")
	m.CloseAll()
	if m.Connected("nope") {
		t.Fatal("unexpected session")
	}
}
