//go:build integration

package conn

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/0funct0ry/helenus/internal/config"
)

func init() {
	// Docker port mapping hides the node's real rpc_address, so only use the contact point.
	clusterHook = func(c *gocql.ClusterConfig) { c.DisableInitialHostLookup = true }
}

func itVersion() string {
	if v := os.Getenv("HELENUS_IT_CASSANDRA_VERSION"); v != "" {
		return v
	}
	return "4.1"
}

type node struct {
	host string
	port int
	// caPEM is the server certificate, trusted as the CA, when TLS is on.
	caPEM string
}

// startCassandra runs cassandra:<version>; secure turns on PasswordAuthenticator and client TLS.
func startCassandra(t *testing.T, secure bool) node {
	t.Helper()
	ctx := context.Background()
	script := ""
	if secure {
		script = `set -e
sed -i 's/AllowAllAuthenticator/PasswordAuthenticator/' /etc/cassandra/cassandra.yaml
keytool -genkeypair -alias node -keyalg RSA -keysize 2048 -dname CN=localhost -ext san=dns:localhost,ip:127.0.0.1,ip:::1 -validity 2 \
  -keystore /etc/cassandra/keystore.jks -storetype JKS -storepass changeit -keypass changeit
keytool -exportcert -rfc -alias node -keystore /etc/cassandra/keystore.jks -storepass changeit -file /tmp/node.pem
sed -i '/^client_encryption_options:/,/^[a-z]/ { s/enabled: false/enabled: true/; s#keystore: .*#keystore: /etc/cassandra/keystore.jks#; s/^[ #]*keystore_password: .*/  keystore_password: changeit/ }' /etc/cassandra/cassandra.yaml
`
	}
	req := testcontainers.ContainerRequest{
		Image:        "cassandra:" + itVersion(),
		ExposedPorts: []string{"9042/tcp"},
		Env:          map[string]string{"MAX_HEAP_SIZE": "512M", "HEAP_NEWSIZE": "128M"},
		Entrypoint:   []string{"bash", "-c", script + "exec docker-entrypoint.sh cassandra -f"},
		WaitingFor:   wait.ForLog("Starting listening for CQL clients").WithStartupTimeout(5 * time.Minute),
	}
	c, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{ContainerRequest: req, Started: true})
	if err != nil {
		t.Fatalf("starting cassandra: %v", err)
	}
	t.Cleanup(func() { _ = testcontainers.TerminateContainer(c) })
	host, err := c.Host(ctx)
	if err != nil {
		t.Fatal(err)
	}
	mapped, err := c.MappedPort(ctx, "9042/tcp")
	if err != nil {
		t.Fatal(err)
	}
	if host == "localhost" {
		host = "127.0.0.1" // the driver verifies the certificate against the resolved IP, not the name
	}
	n := node{host: host, port: int(mapped.Num())}
	if secure {
		r, err := c.CopyFileFromContainer(ctx, "/tmp/node.pem")
		if err != nil {
			t.Fatal(err)
		}
		pem, _ := io.ReadAll(r)
		n.caPEM = string(pem)
	}
	return n
}

func (n node) profile(t *testing.T) config.Profile {
	return config.Profile{Name: "it", Hosts: []string{n.host}, Port: n.port, ConnectTimeout: "10s", RequestTimeout: "15s"}
}

func (n node) withTLS(t *testing.T) config.Profile {
	p := n.profile(t)
	ca := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(ca, []byte(n.caPEM), 0o600); err != nil {
		t.Fatal(err)
	}
	p.TLS = config.TLS{Enabled: true, CACert: ca}
	return p
}

// eventually retries while a freshly started node finishes creating system_auth roles.
func eventually(t *testing.T, p config.Profile) *TestResult {
	t.Helper()
	var res *TestResult
	for i := 0; i < 30; i++ {
		res = Test(context.Background(), p)
		if res.OK {
			return res
		}
		time.Sleep(3 * time.Second)
	}
	return res
}

func TestIntegrationPlain(t *testing.T) {
	n := startCassandra(t, false)
	res := Test(context.Background(), n.profile(t))
	if !res.OK {
		t.Fatalf("test failed: %+v", res)
	}
	if !strings.HasPrefix(res.Info.ReleaseVersion, itVersion()) || res.Info.NodeCount != 1 || res.Info.LocalDC == "" {
		t.Fatalf("info = %+v", res.Info)
	}

	m := NewManager()
	defer m.CloseAll()
	s1, _, err := m.Session(context.Background(), "it", n.profile(t))
	if err != nil {
		t.Fatal(err)
	}
	s2, _, err := m.Session(context.Background(), "it", n.profile(t))
	if err != nil || s1 != s2 {
		t.Fatalf("session not reused: %v", err)
	}
	changed := n.profile(t)
	changed.Keyspace = "system"
	s3, _, err := m.Session(context.Background(), "it", changed)
	if err != nil || s3 == s1 || !s1.Closed() {
		t.Fatalf("changed profile must replace the session: %v", err)
	}
}

func TestIntegrationUnreachable(t *testing.T) {
	p := config.Profile{Hosts: []string{"127.0.0.1"}, Port: 1, ConnectTimeout: "2s"}
	if res := Test(context.Background(), p); res.OK || res.FailedStage != StageTCP {
		t.Fatalf("%+v", res)
	}
}

func TestIntegrationPasswordAndTLS(t *testing.T) {
	n := startCassandra(t, true)
	good := n.withTLS(t)
	good.Username, good.Password = "cassandra", "cassandra"
	res := eventually(t, good)
	if !res.OK {
		t.Fatalf("valid credentials over TLS failed: %+v", res)
	}
	if got := fmt.Sprint(res.Stages[2].Name, res.Stages[2].OK); got != "tlstrue" {
		t.Fatalf("stages = %+v", res.Stages)
	}

	bad := good
	bad.Password = "wrong"
	if res := Test(context.Background(), bad); res.OK || res.FailedStage != StageAuth {
		t.Fatalf("wrong password: %+v", res)
	}

	noCreds := n.withTLS(t)
	if res := Test(context.Background(), noCreds); res.OK || res.FailedStage != StageAuth {
		t.Fatalf("missing credentials: %+v", res)
	}

	wrongCA := good
	wrongCA.TLS.CACert = filepath.Join(t.TempDir(), "other.pem")
	if err := os.WriteFile(wrongCA.TLS.CACert, unrelatedCAPEM(), 0o600); err != nil {
		t.Fatal(err)
	}
	res = Test(context.Background(), wrongCA)
	if res.OK || res.FailedStage != StageTLS || !strings.Contains(res.Error, "certificate") {
		t.Fatalf("wrong CA must fail at the tls stage: %+v", res)
	}

	insecure := good
	insecure.TLS.CACert, insecure.TLS.InsecureSkipVerify = "", true
	res = Test(context.Background(), insecure)
	if !res.OK || len(res.Warnings) == 0 {
		t.Fatalf("insecure connect must work and warn: %+v", res)
	}
}
