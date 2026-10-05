//go:build integration

package history

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/0funct0ry/helenus/internal/schema"
)

func itVersion() string {
	if v := os.Getenv("HELENUS_IT_CASSANDRA_VERSION"); v != "" {
		return v
	}
	return "4.1"
}

// session returns a session on a node with MVs and UDFs enabled: HELENUS_IT_ADDR (host:port) if set,
// otherwise a fresh testcontainers node.
func session(t *testing.T) *gocql.Session {
	t.Helper()
	host, port := "", 0
	if addr := os.Getenv("HELENUS_IT_ADDR"); addr != "" {
		if _, err := fmt.Sscanf(strings.Replace(addr, ":", " ", 1), "%s %d", &host, &port); err != nil {
			t.Fatal(err)
		}
	} else {
		ctx := context.Background()
		script := `sed -i 's/^materialized_views_enabled:.*/materialized_views_enabled: true/; s/^user_defined_functions_enabled:.*/user_defined_functions_enabled: true/' /etc/cassandra/cassandra.yaml
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
		host, port = h, int(mp.Num())
	}
	cl := gocql.NewCluster(host)
	cl.Port = port
	cl.DisableInitialHostLookup = true
	cl.Timeout = 30 * time.Second
	cl.ConnectTimeout = 30 * time.Second
	var s *gocql.Session
	var err error
	for i := 0; i < 40; i++ {
		if s, err = cl.CreateSession(); err == nil {
			break
		}
		time.Sleep(3 * time.Second)
	}
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s
}

// step runs stmt the way the UI path does: snapshot first, execute, then derive the reverse.
func step(t *testing.T, s *gocql.Session, stmt string) (reverse string) {
	t.Helper()
	before, err := schema.Build(context.Background(), s)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Query(stmt).Exec(); err != nil {
		t.Fatalf("%s: %v", stmt, err)
	}
	reverse, _ = Reverse(before, "m904", stmt)
	return reverse
}

func tableDDL(t *testing.T, s *gocql.Session) string {
	t.Helper()
	snap, err := schema.Build(context.Background(), s)
	if err != nil {
		t.Fatal(err)
	}
	if tb := tableOf(snap, "m904", "users"); tb != nil {
		return schema.TableDDL(*tb)
	}
	return ""
}

// TestReverseRestoresSchema runs create, alter and drop, then each reverse script, and checks the table
// DDL is back to what it was before every statement (data is not part of the comparison).
func TestReverseRestoresSchema(t *testing.T) {
	s := session(t)
	_ = s.Query(`DROP KEYSPACE IF EXISTS m904`).Exec()
	if err := s.Query(`CREATE KEYSPACE m904 WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}`).Exec(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Query(`DROP KEYSPACE IF EXISTS m904`).Exec() })

	create := "CREATE TABLE m904.users (id uuid PRIMARY KEY, name text, email text)"
	rev := step(t, s, create)
	if tableDDL(t, s) == "" {
		t.Fatal("table was not created")
	}
	if err := s.Query(rev).Exec(); err != nil {
		t.Fatalf("%s: %v", rev, err)
	}
	if tableDDL(t, s) != "" {
		t.Fatal("reverse of CREATE did not drop the table")
	}

	if err := s.Query(create).Exec(); err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		"ALTER TABLE m904.users ADD age int",
		"ALTER TABLE m904.users WITH gc_grace_seconds = 3600",
		"ALTER TABLE m904.users WITH comment = 'it''s new' AND default_time_to_live = 60",
		"ALTER TABLE m904.users DROP email",
	} {
		want := tableDDL(t, s)
		rev := step(t, s, stmt)
		if rev == "" {
			t.Fatalf("no reverse for %s", stmt)
		}
		if tableDDL(t, s) == want {
			t.Fatalf("%s changed nothing", stmt)
		}
		if err := s.Query(rev).Exec(); err != nil {
			t.Fatalf("reverse of %s: %s: %v", stmt, rev, err)
		}
		if got := tableDDL(t, s); got != want {
			t.Fatalf("reverse of %s did not restore the schema:\n got %s\nwant %s", stmt, got, want)
		}
	}

	want := tableDDL(t, s)
	rev = step(t, s, "DROP TABLE m904.users")
	if tableDDL(t, s) != "" {
		t.Fatal("table was not dropped")
	}
	if err := s.Query(rev).Exec(); err != nil {
		t.Fatalf("%s: %v", rev, err)
	}
	if got := tableDDL(t, s); got != want {
		t.Fatalf("recreate mismatch:\n got %s\nwant %s", got, want)
	}

	// A UDT: create then reverse.
	rev = step(t, s, "CREATE TYPE m904.addr (street text)")
	if rev != "DROP TYPE m904.addr;" {
		t.Fatalf("type reverse %q", rev)
	}
	if err := s.Query(rev).Exec(); err != nil {
		t.Fatal(err)
	}
}
