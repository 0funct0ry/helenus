//go:build integration

package trace

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/network"
	"github.com/testcontainers/testcontainers-go/wait"
)

func itVersion() string {
	if v := os.Getenv("HELENUS_IT_CASSANDRA_VERSION"); v != "" {
		return v
	}
	return "4.1"
}

// startRing boots a three-node cluster on one Docker network and returns a
// session on the first node. Nodes join one at a time, as Cassandra requires.
func startRing(t *testing.T) *gocql.Session {
	t.Helper()
	ctx := context.Background()
	net, err := network.New(ctx)
	if err != nil {
		t.Fatalf("creating network: %v", err)
	}
	t.Cleanup(func() { _ = net.Remove(ctx) })

	var first testcontainers.Container
	for i := 1; i <= 3; i++ {
		name := fmt.Sprintf("cass%d", i)
		req := testcontainers.ContainerRequest{
			Image:          "cassandra:" + itVersion(),
			ExposedPorts:   []string{"9042/tcp"},
			Networks:       []string{net.Name},
			NetworkAliases: map[string][]string{net.Name: {name}},
			Env: map[string]string{
				"MAX_HEAP_SIZE": "512M", "HEAP_NEWSIZE": "128M",
				"CASSANDRA_SEEDS": "cass1", "CASSANDRA_CLUSTER_NAME": "helenus-it",
			},
			WaitingFor: wait.ForLog("Starting listening for CQL clients").WithStartupTimeout(6 * time.Minute),
		}
		c, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{ContainerRequest: req, Started: true})
		if err != nil {
			t.Fatalf("starting %s: %v", name, err)
		}
		t.Cleanup(func() { _ = testcontainers.TerminateContainer(c) })
		if i == 1 {
			first = c
		}
	}
	host, err := first.Host(ctx)
	if err != nil {
		t.Fatal(err)
	}
	port, err := first.MappedPort(ctx, "9042/tcp")
	if err != nil {
		t.Fatal(err)
	}
	if host == "localhost" {
		host = "127.0.0.1"
	}
	cl := gocql.NewCluster(host)
	cl.Port = int(port.Num())
	// Docker port mapping hides the other nodes, so talk to the first node only.
	cl.DisableInitialHostLookup = true
	cl.Timeout = 20 * time.Second
	sess, err := cl.CreateSession()
	if err != nil {
		t.Fatalf("connecting: %v", err)
	}
	t.Cleanup(sess.Close)

	deadline := time.Now().Add(2 * time.Minute)
	for {
		n := 0
		it := sess.Query("SELECT peer FROM system.peers").Iter()
		var peer string
		for it.Scan(&peer) {
			n++
		}
		_ = it.Close()
		if n == 2 {
			return sess
		}
		if time.Now().After(deadline) {
			t.Fatalf("ring has %d peers, want 2", n)
		}
		time.Sleep(2 * time.Second)
	}
}

func tracedSelect(t *testing.T, sess *gocql.Session, cl gocql.Consistency) *Trace {
	t.Helper()
	var id []byte
	tr := idCapture{&id}
	var v int
	err := sess.Query("SELECT v FROM trace_it.t WHERE k = 1").Consistency(cl).Trace(tr).Scan(&v)
	if err != nil {
		t.Fatal(err)
	}
	u, err := gocql.UUIDFromBytes(id)
	if err != nil {
		t.Fatalf("no trace id: %v", err)
	}
	got, err := Fetch(context.Background(), NewSource(sess), u.String(), 10*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

type idCapture struct{ id *[]byte }

func (c idCapture) Trace(id []byte) { *c.id = append([]byte(nil), id...) }

func TestIntegrationTraceThreeNodes(t *testing.T) {
	sess := startRing(t)
	for _, q := range []string{
		"CREATE KEYSPACE trace_it WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 3}",
		"CREATE TABLE trace_it.t (k int PRIMARY KEY, v int)",
	} {
		if err := sess.Query(q).Exec(); err != nil {
			t.Fatal(err)
		}
	}
	if err := sess.Query("INSERT INTO trace_it.t (k, v) VALUES (1, 10)").Consistency(gocql.All).Exec(); err != nil {
		t.Fatal(err)
	}

	// At QUORUM the coordinator needs two of the three replicas, so at least two
	// lanes appear; at ALL every replica takes part, so all three do.
	q := tracedSelect(t, sess, gocql.Quorum)
	if len(q.Lanes) < 2 || q.Lanes[0].Role != "coordinator" || q.Summary.EventCount == 0 || q.DurationUS <= 0 {
		t.Fatalf("QUORUM trace = %+v", q.Summary)
	}
	a := tracedSelect(t, sess, gocql.All)
	if len(a.Lanes) != 3 || a.Summary.ReplicasContacted != 2 {
		t.Fatalf("ALL trace lanes = %d, summary = %+v", len(a.Lanes), a.Summary)
	}
	seen := map[string]bool{}
	for _, e := range a.Events {
		seen[e.Source] = true
	}
	if len(seen) != 3 {
		t.Errorf("events come from %d nodes, want 3", len(seen))
	}
}
