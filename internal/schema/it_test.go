//go:build integration

package schema

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
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

func loadFixture(t *testing.T, s *gocql.Session, files ...string) {
	t.Helper()
	_ = s.Query(`DROP KEYSPACE IF EXISTS payments`).Exec()
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for _, stmt := range strings.Split(string(b), ";\n") {
			if stmt = strings.TrimSpace(stmt); stmt == "" {
				continue
			}
			if err := s.Query(stmt).Exec(); err != nil {
				t.Fatalf("fixture: %v\n%s", err, stmt)
			}
		}
	}
}

// TestGeneratedMatchesServer compares generated DDL with the server's DESCRIBE for every object in the
// fixture, on whichever Cassandra version the run targets.
func TestGeneratedMatchesServer(t *testing.T) {
	ctx := context.Background()
	s := session(t)
	files := []string{"testdata/fixture.cql"}
	if MajorVersion(itVersion()) >= 5 {
		files = append(files, "testdata/fixture_50.cql")
	}
	loadFixture(t, s, files...)
	snap, err := Build(ctx, s)
	if err != nil {
		t.Fatal(err)
	}
	ks := snap.Keyspace("payments")
	if ks == nil {
		t.Fatal("payments missing from snapshot")
	}

	targets := []Target{{Kind: KeyspaceT, Name: "payments"}}
	for _, x := range ks.Tables {
		targets = append(targets, Target{Kind: TableT, Keyspace: "payments", Name: x.Name})
		for _, i := range x.Indexes {
			targets = append(targets, Target{Kind: IndexT, Keyspace: "payments", Name: i.Name})
		}
	}
	for _, x := range ks.Views {
		targets = append(targets, Target{Kind: ViewT, Keyspace: "payments", Name: x.Name})
	}
	for _, x := range ks.Types {
		targets = append(targets, Target{Kind: TypeT, Keyspace: "payments", Name: x.Name})
	}
	for _, x := range ks.Functions {
		targets = append(targets, Target{Kind: FunctionT, Keyspace: "payments", Name: x.Name})
	}
	for _, x := range ks.Aggregates {
		targets = append(targets, Target{Kind: AggregateT, Keyspace: "payments", Name: x.Name})
	}
	for _, tg := range targets {
		want, err := describeServer(ctx, s, tg, "")
		if err != nil {
			t.Errorf("%s: server: %v", tg.Statement(""), err)
			continue
		}
		got, err := Generate(snap, tg, "")
		if err != nil {
			t.Errorf("%s: generate: %v", tg.Statement(""), err)
			continue
		}
		checkGolden(t, tg, want)
		if got != want {
			t.Errorf("%s differs\n%s", tg.Statement(""), lineDiff(want, got))
		}
	}
}

// checkGolden compares the server's output with the checked-in golden file, or rewrites it when
// HELENUS_UPDATE_GOLDEN is set.
func checkGolden(t *testing.T, tg Target, server string) {
	t.Helper()
	name := strings.NewReplacer(" ", "_", ".", "-").Replace(strings.ToLower(tg.Statement(""))) + ".cql"
	path := filepath.Join("testdata", "golden", itVersion(), name)
	if os.Getenv("HELENUS_UPDATE_GOLDEN") != "" {
		_ = os.MkdirAll(filepath.Dir(path), 0o755)
		if err := os.WriteFile(path, []byte(server), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Errorf("missing golden %s (run with HELENUS_UPDATE_GOLDEN=1)", path)
		return
	}
	if string(b) != server {
		t.Errorf("%s: server output changed from golden %s\n%s", tg.Statement(""), path, lineDiff(string(b), server))
	}
}

// TestSnapshotOfFixture checks the compact snapshot against the fixture schema: key kinds and
// positions, clustering order, statics, views on their base table, UDT usage and the 5.0 SAI index.
func TestSnapshotOfFixture(t *testing.T) {
	ctx := context.Background()
	s := session(t)
	files := []string{"testdata/fixture.cql"}
	if MajorVersion(itVersion()) >= 5 {
		files = append(files, "testdata/fixture_50.cql")
	}
	loadFixture(t, s, files...)
	snap, err := Build(ctx, s)
	if err != nil {
		t.Fatal(err)
	}
	if MajorVersion(snap.Version) != MajorVersion(itVersion()) {
		t.Errorf("version %s, want %s.x", snap.Version, itVersion())
	}
	ks := snap.Keyspace("payments")
	txn := ks.Table("transactions_by_merchant")
	var got []string
	for _, c := range txn.Columns[:5] {
		got = append(got, fmt.Sprintf("%s:%s:%d:%s", c.Name, c.Kind, c.Position, c.Order))
	}
	want := []string{"merchant_id:partition:1:", "txn_day:partition:2:", "txn_time:clustering:1:DESC", "merchant_name:static:0:", "amount:regular:0:"}
	if strings.Join(got, " ") != strings.Join(want, " ") {
		t.Errorf("columns = %v, want %v", got, want)
	}
	if v := strings.Join(txn.Views, ","); v != "transactions_by_status" {
		t.Errorf("views on base table = %q", v)
	}
	if ks.View("transactions_by_status").BaseTable != "transactions_by_merchant" {
		t.Error("view base table not recorded")
	}
	if u := strings.Join(ks.Type("address").UsedBy, ","); !strings.Contains(u, "transactions_by_merchant.billing") || !strings.Contains(u, "billing_profile.home") {
		t.Errorf("address used_by = %s", u)
	}
	if !ks.Table("ledger_counters").Counter {
		t.Error("counter table not flagged")
	}
	for _, c := range ks.Table("merchants").Columns {
		if c.Name == "nested" && c.CQL != "map<text, frozen<list<frozen<tuple<int, text>>>>>" {
			t.Errorf("nested type = %s", c.CQL)
		}
	}
	if MajorVersion(itVersion()) >= 5 {
		var sai bool
		for _, i := range ks.Table("merchants").Indexes {
			sai = sai || (i.Name == "merchants_name_sai" && i.SAI)
		}
		if !sai {
			t.Error("SAI index not detected")
		}
	}
	if sys := snap.Keyspace("system_schema"); sys == nil || !sys.System {
		t.Error("system_schema should be flagged as a system keyspace")
	}
}
