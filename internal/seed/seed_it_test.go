//go:build integration

package seed

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

	"github.com/0funct0ry/helenus/internal/jobs"
	"github.com/0funct0ry/helenus/internal/schema"
)

func itSession(t *testing.T) *gocql.Session {
	t.Helper()
	host, port := "", 0
	if addr := os.Getenv("HELENUS_IT_ADDR"); addr != "" {
		if _, err := fmt.Sscanf(strings.Replace(addr, ":", " ", 1), "%s %d", &host, &port); err != nil {
			t.Fatal(err)
		}
	} else {
		ver := os.Getenv("HELENUS_IT_CASSANDRA_VERSION")
		if ver == "" {
			ver = "4.1"
		}
		ctx := context.Background()
		c, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
			ContainerRequest: testcontainers.ContainerRequest{
				Image:        "cassandra:" + ver,
				ExposedPorts: []string{"9042/tcp"},
				Env:          map[string]string{"MAX_HEAP_SIZE": "512M", "HEAP_NEWSIZE": "128M"},
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

type sessExec struct{ s *gocql.Session }

func (e sessExec) Exec(ctx context.Context, cql string, args []any, cons string) error {
	c, err := gocql.ParseConsistencyWrapper(cons)
	if err != nil {
		return err
	}
	return e.s.Query(cql, args...).Consistency(c).ExecContext(ctx)
}

// TestSeedComposite seeds 100,000 rows into a composite-key table, then checks
// the partition count and per-partition row counts on a sample.
func TestSeedComposite(t *testing.T) {
	s := itSession(t)
	ctx := context.Background()
	for _, q := range []string{
		`CREATE KEYSPACE IF NOT EXISTS m915 WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}`,
		`CREATE TABLE IF NOT EXISTS m915.events (tenant text, day date, ts timeuuid, payload text, tags set<text>, PRIMARY KEY ((tenant, day), ts))`,
		`CREATE TABLE IF NOT EXISTS m915.hits (page text, n counter, PRIMARY KEY (page))`,
	} {
		if err := s.Query(q).Exec(); err != nil {
			t.Fatal(err)
		}
	}
	snap, err := schema.Build(ctx, s)
	if err != nil {
		t.Fatal(err)
	}
	tbl := snap.Keyspace("m915").Table("events")
	plan, errs := NewPlan(*tbl, snap, Config{Seed: 42, TotalRows: 100000, RowsPerPartition: 100, Concurrency: 32, Consistency: "ONE"}, Now())
	if plan == nil {
		t.Fatalf("%+v", errs)
	}
	reg := jobs.New()
	j := reg.Start("seed", "it", func(ctx context.Context, rep *jobs.Reporter) error { return plan.Run(ctx, sessExec{s}, rep) })
	var got jobs.Job
	for i := 0; i < 600; i++ {
		got, _ = reg.Get("it", j.ID)
		if got.State != jobs.Running {
			break
		}
		time.Sleep(time.Second)
	}
	res, _ := got.Result.(Result)
	if got.State != jobs.Done || res.Written != 100000 || res.Errors != 0 {
		t.Fatalf("state=%s result=%+v", got.State, res)
	}
	var parts int
	iter := s.Query(`SELECT DISTINCT tenant, day FROM m915.events`).Iter()
	var tenant string
	var day time.Time
	var sample [][2]any
	for iter.Scan(&tenant, &day) {
		parts++
		if len(sample) < 20 {
			sample = append(sample, [2]any{tenant, day})
		}
	}
	if err := iter.Close(); err != nil {
		t.Fatal(err)
	}
	if parts != 1000 {
		t.Fatalf("partitions = %d, want 1000", parts)
	}
	for _, k := range sample {
		var n int
		if err := s.Query(`SELECT COUNT(*) FROM m915.events WHERE tenant = ? AND day = ?`, k[0], k[1]).Scan(&n); err != nil || n != 100 {
			t.Fatalf("partition %v has %d rows (%v)", k, n, err)
		}
	}

	// Counter tables are seeded through UPDATE increments.
	ctbl := snap.Keyspace("m915").Table("hits")
	cplan, errs := NewPlan(*ctbl, snap, Config{Seed: 1, TotalRows: 50, Concurrency: 4, Consistency: "ONE"}, Now())
	if cplan == nil {
		t.Fatalf("%+v", errs)
	}
	j = reg.Start("seed", "it", func(ctx context.Context, rep *jobs.Reporter) error { return cplan.Run(ctx, sessExec{s}, rep) })
	for i := 0; i < 60; i++ {
		if got, _ = reg.Get("it", j.ID); got.State != jobs.Running {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	var cnt int
	if got.State != jobs.Done || s.Query(`SELECT COUNT(*) FROM m915.hits`).Scan(&cnt) != nil || cnt != 50 {
		t.Fatalf("counter seed: state=%s rows=%d", got.State, cnt)
	}
}
