//go:build integration

package export

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/0funct0ry/helenus/internal/exec"
	"github.com/0funct0ry/helenus/internal/schema"
)

func itVersion() string {
	if v := os.Getenv("HELENUS_IT_CASSANDRA_VERSION"); v != "" {
		return v
	}
	return "4.1"
}

// session returns a session on HELENUS_IT_ADDR (host:port) if set, otherwise on
// a fresh testcontainers node.
func session(t *testing.T) *gocql.Session {
	t.Helper()
	host, port := "", 0
	if addr := os.Getenv("HELENUS_IT_ADDR"); addr != "" {
		if _, err := fmt.Sscanf(strings.Replace(addr, ":", " ", 1), "%s %d", &host, &port); err != nil {
			t.Fatal(err)
		}
	} else {
		ctx := context.Background()
		// The fixture creates a materialized view, which Cassandra 4.0+ disables by default.
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
	require.NoError(t, err)
	t.Cleanup(s.Close)
	return s
}

func seedTable(t *testing.T, s *gocql.Session, rows int) *exec.Executor {
	t.Helper()
	require.NoError(t, s.Query(`DROP KEYSPACE IF EXISTS exp_it`).Exec())
	require.NoError(t, s.Query(`CREATE KEYSPACE exp_it WITH replication = {'class':'SimpleStrategy','replication_factor':1}`).Exec())
	require.NoError(t, s.Query(`CREATE TABLE exp_it.t (id int, ck int, v text, m map<text,int>, ts timestamp, PRIMARY KEY (id, ck))`).Exec())
	for i := 0; i < rows; i++ {
		require.NoError(t, s.Query(`INSERT INTO exp_it.t (id, ck, v, m, ts) VALUES (?, ?, ?, ?, ?)`,
			i%50, i, fmt.Sprintf("row, %d \"q\"", i), map[string]int{"a": i}, time.Unix(int64(i), 0)).Exec())
	}
	snap, err := schema.Build(context.Background(), s)
	require.NoError(t, err)
	return &exec.Executor{Session: s, Snapshot: func(context.Context) *schema.Snapshot { return snap }}
}

// TestExportRoundTrip exports a table with and without a token-range split and
// checks every row survives CSV quoting.
func TestExportRoundTrip(t *testing.T) {
	s := session(t)
	ex := seedTable(t, s, 2000)
	for _, ranges := range []int{1, 8} {
		var buf bytes.Buffer
		w, err := NewWriter(CSV, &buf, Options{Header: true}, nil)
		require.NoError(t, err)
		n, err := Run(context.Background(), ex, Source{Keyspace: "exp_it", Table: "t", Columns: []string{"id", "ck", "m", "v"}, PartitionKey: []string{"id"}},
			Config{PageSize: 100, Ranges: ranges, Concurrency: 4}, w)
		require.NoError(t, err)
		require.EqualValues(t, 2000, n)
		recs, err := csv.NewReader(&buf).ReadAll()
		require.NoError(t, err)
		require.Len(t, recs, 2001)
		seen := map[string]bool{}
		for _, r := range recs[1:] {
			ck, _ := strconv.Atoi(r[1])
			require.Equal(t, fmt.Sprintf("row, %d \"q\"", ck), r[3], "v column")
			require.Equal(t, fmt.Sprintf("{'a': %d}", ck), r[2], "m column")
			seen[r[1]] = true
		}
		require.Len(t, seen, 2000, "ranges=%d lost or duplicated rows", ranges)
	}
	var buf bytes.Buffer
	w, _ := NewWriter(JSON, &buf, Options{}, nil)
	_, err := Run(context.Background(), ex, Source{Query: "SELECT m FROM exp_it.t WHERE id = 0 AND ck = 0"}, Config{}, w)
	require.NoError(t, err)
	require.Equal(t, "[\n{\"m\":[[\"a\",0]]}\n]\n", buf.String())
}

// TestExportMemory exports HELENUS_IT_EXPORT_ROWS rows (default skipped; the
// acceptance run uses 5000000) and requires the heap to stay flat.
func TestExportMemory(t *testing.T) {
	n, _ := strconv.Atoi(os.Getenv("HELENUS_IT_EXPORT_ROWS"))
	if n == 0 {
		t.Skip("set HELENUS_IT_EXPORT_ROWS to run the memory test")
	}
	s := session(t)
	ex := seedTable(t, s, 0)
	work := make(chan int, 1024)
	var wg sync.WaitGroup
	for w := 0; w < 32; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range work {
				if err := s.Query(`INSERT INTO exp_it.t (id, ck, v) VALUES (?, ?, ?)`, j%5000, j, strings.Repeat("x", 40)).Exec(); err != nil {
					t.Error(err)
					return
				}
			}
		}()
	}
	for j := 0; j < n; j++ {
		work <- j
	}
	close(work)
	wg.Wait()
	require.False(t, t.Failed())
	f, err := os.CreateTemp(t.TempDir(), "export-*.csv")
	require.NoError(t, err)
	defer f.Close()
	w, _ := NewWriter(CSV, f, Options{}, nil)
	var peak uint64
	done := make(chan struct{})
	go func() {
		var m runtime.MemStats
		for {
			select {
			case <-done:
				return
			case <-time.After(200 * time.Millisecond):
				runtime.ReadMemStats(&m)
				peak = max(peak, m.HeapAlloc)
			}
		}
	}()
	got, err := Run(context.Background(), ex, Source{Keyspace: "exp_it", Table: "t", PartitionKey: []string{"id"}}, Config{PageSize: 5000, Ranges: 8, Concurrency: 4}, w)
	close(done)
	require.NoError(t, err)
	require.EqualValues(t, n, got)
	require.Less(t, peak, uint64(150<<20), "heap peaked at %d MB", peak>>20)
}
