package config

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestResolveSecrets(t *testing.T) {
	t.Setenv("HEL_PW", "s3cret")
	p, err := Profile{Password: "${HEL_PW}", Username: "$HEL_PW"}.ResolveSecrets(context.Background())
	if err != nil || p.Password != "s3cret" || p.Username != "s3cret" {
		t.Fatalf("got %+v, %v", p, err)
	}
	p, err = Profile{PasswordCommand: "echo '  piped  '"}.ResolveSecrets(context.Background())
	if err != nil || p.Password != "piped" {
		t.Fatalf("got %q, %v", p.Password, err)
	}
	p, err = Profile{Astra: Astra{TokenCommand: "echo AstraCS:x"}}.ResolveSecrets(context.Background())
	if err != nil || p.Astra.Token != "AstraCS:x" {
		t.Fatalf("got %q, %v", p.Astra.Token, err)
	}
	if _, err = (Profile{PasswordCommand: "exit 3"}).ResolveSecrets(context.Background()); err == nil {
		t.Fatal("expected failure")
	}
}

func TestSecretCommandTimeout(t *testing.T) {
	start := time.Now()
	_, err := Profile{PasswordCommand: "sleep 30"}.ResolveSecrets(context.Background())
	if err == nil || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("err = %v", err)
	}
	if time.Since(start) > 8*time.Second {
		t.Fatalf("took %v", time.Since(start))
	}
}

func TestRedacted(t *testing.T) {
	r := Profile{Password: "x", Astra: Astra{Token: "t"}}.Redacted()
	if !r.PasswordSet || !r.TokenSet || r.PasswordCommandSet {
		t.Fatalf("%+v", r)
	}
}

func TestLoadProfileAndResolve(t *testing.T) {
	path := writeConfig(t, "profiles:\n  p1:\n    hosts: [a, b]\n    port: 9999\n    tls: {enabled: true, ca_cert: /c.pem}\n")
	p, err := LoadProfile(path, "p1")
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Hosts) != 2 || p.Port != 9999 || !p.TLS.Enabled || p.TLS.CACert != "/c.pem" || p.Consistency != "LOCAL_ONE" {
		t.Fatalf("%+v", p)
	}
	if _, err := LoadProfile(path, "zz"); err == nil {
		t.Fatal("want unknown profile")
	}
	list, err := LoadProfiles(path)
	if err != nil || len(list) != 1 {
		t.Fatalf("%v %v", list, err)
	}
}

func TestApplyFields(t *testing.T) {
	base := Profile{Name: "p", Hosts: []string{"a"}, Port: 1, Password: "keep", TLS: TLS{Enabled: true, CACert: "/x"}}
	got, err := ApplyFields(base, map[string]any{"port": 2, "tls.ca_cert": nil, "keyspace": "ks"})
	if err != nil {
		t.Fatal(err)
	}
	if got.Port != 2 || got.Password != "keep" || got.TLS.CACert != "" || !got.TLS.Enabled || got.Keyspace != "ks" || got.Name != "p" {
		t.Fatalf("%+v", got)
	}
}
