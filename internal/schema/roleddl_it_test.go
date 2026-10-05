//go:build integration

package schema

import (
	"context"
	"strings"
	"testing"
	"time"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

// authSession starts a node with PasswordAuthenticator and CassandraAuthorizer and returns the host, port
// and a superuser session. system_auth is created lazily, so the connection is retried.
func authSession(t *testing.T) (string, int, *gocql.Session) {
	t.Helper()
	ctx := context.Background()
	script := `sed -i 's/^authenticator:.*/authenticator: PasswordAuthenticator/; s/^authorizer:.*/authorizer: CassandraAuthorizer/' /etc/cassandra/cassandra.yaml
exec docker-entrypoint.sh cassandra -f`
	c, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "cassandra:" + itVersion(),
			ExposedPorts: []string{"9042/tcp"},
			Env:          map[string]string{"MAX_HEAP_SIZE": "512M", "HEAP_NEWSIZE": "128M"},
			Entrypoint:   []string{"bash", "-c", script},
			WaitingFor:   wait.ForLog("Starting listening for CQL clients").WithStartupTimeout(5 * time.Minute),
		},
		Started: true,
	})
	if err != nil {
		t.Fatalf("starting cassandra: %v", err)
	}
	t.Cleanup(func() { _ = testcontainers.TerminateContainer(c) })
	h, _ := c.Host(ctx)
	if h == "localhost" {
		h = "127.0.0.1"
	}
	mp, _ := c.MappedPort(ctx, "9042/tcp")
	port := int(mp.Num())
	s := loginAs(t, h, port, "cassandra", "cassandra")
	return h, port, s
}

func loginAs(t *testing.T, host string, port int, user, pass string) *gocql.Session {
	t.Helper()
	cl := gocql.NewCluster(host)
	cl.Port = port
	cl.DisableInitialHostLookup = true
	cl.Timeout = 30 * time.Second
	cl.ConnectTimeout = 30 * time.Second
	cl.Authenticator = gocql.PasswordAuthenticator{Username: user, Password: pass}
	var s *gocql.Session
	var err error
	for i := 0; i < 40; i++ {
		if s, err = cl.CreateSession(); err == nil {
			break
		}
		time.Sleep(3 * time.Second)
	}
	if err != nil {
		t.Fatalf("login %s: %v", user, err)
	}
	t.Cleanup(s.Close)
	return s
}

// TestRolesEndToEnd renders role statements with the planner, runs them on a secured node, and checks that the
// granted role can read but not write.
func TestRolesEndToEnd(t *testing.T) {
	host, port, admin := authSession(t)
	for _, q := range []string{
		`CREATE KEYSPACE shop WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}`,
		`CREATE TABLE shop.orders (id int PRIMARY KEY, v text)`,
		`INSERT INTO shop.orders (id, v) VALUES (1, 'a')`,
	} {
		if err := admin.Query(q).Exec(); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	snap, err := Build(context.Background(), admin)
	if err != nil {
		t.Fatal(err)
	}
	rc := RoleContext{MemberOf: map[string][]string{"cassandra": nil}, Connected: "cassandra", Major: MajorVersion(itVersion())}
	run := func(req RoleRequest) {
		t.Helper()
		stmt, errs := RenderRole(snap, rc, req)
		if len(errs) != 0 {
			t.Fatalf("plan %+v: %v", req, errs)
		}
		if err := admin.Query(stmt).Exec(); err != nil {
			t.Fatalf("%s: %v", strings.ReplaceAll(stmt, req.Password, "***"), err)
		}
	}
	yes := true
	run(RoleRequest{Action: RoleCreate, Role: "analyst", Password: "analyst-pass-1", Login: &yes})
	rc.MemberOf["analyst"] = nil
	run(RoleRequest{Action: RoleGrant, Role: "analyst", Permission: "SELECT", Resource: &Resource{Kind: ResKeyspace, Keyspace: "shop"}})

	it := admin.Query(`LIST ALL PERMISSIONS OF analyst`).Iter()
	m := map[string]any{}
	found := false
	for it.MapScan(m) {
		found = found || m["permission"] == "SELECT"
		m = map[string]any{}
	}
	if err := it.Close(); err != nil || !found {
		t.Fatalf("permissions listing: found=%v err=%v", found, err)
	}

	a := loginAs(t, host, port, "analyst", "analyst-pass-1")
	var v string
	if err := a.Query(`SELECT v FROM shop.orders WHERE id = 1`).Scan(&v); err != nil || v != "a" {
		t.Fatalf("select as analyst: %q %v", v, err)
	}
	if err := a.Query(`INSERT INTO shop.orders (id, v) VALUES (2, 'b')`).Exec(); err == nil {
		t.Fatal("insert should be unauthorized")
	}

	run(RoleRequest{Action: RoleRevoke, Role: "analyst", Permission: "SELECT", Resource: &Resource{Kind: ResKeyspace, Keyspace: "shop"}})
	run(RoleRequest{Action: RoleDrop, Role: "analyst"})
}
