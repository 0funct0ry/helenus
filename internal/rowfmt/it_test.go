//go:build integration

package rowfmt

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/0funct0ry/helenus/internal/exec"
	"github.com/0funct0ry/helenus/internal/schema"
)

func itSession(t *testing.T) *gocql.Session {
	t.Helper()
	host, port := "", 0
	if addr := os.Getenv("HELENUS_IT_ADDR"); addr != "" {
		_, err := fmt.Sscanf(strings.Replace(addr, ":", " ", 1), "%s %d", &host, &port)
		require.NoError(t, err)
	} else {
		ctx := context.Background()
		v := os.Getenv("HELENUS_IT_CASSANDRA_VERSION")
		if v == "" {
			v = "4.1"
		}
		c, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
			ContainerRequest: testcontainers.ContainerRequest{
				Image:        "cassandra:" + v,
				ExposedPorts: []string{"9042/tcp"},
				Env:          map[string]string{"MAX_HEAP_SIZE": "512M", "HEAP_NEWSIZE": "128M"},
				WaitingFor:   wait.ForLog("Starting listening for CQL clients").WithStartupTimeout(5 * time.Minute),
			},
			Started: true,
		})
		require.NoError(t, err)
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

// selectAll runs SELECT * and returns the wire columns and rows as a Request.
func selectAll(t *testing.T, s *gocql.Session, table string) Request {
	t.Helper()
	snap, err := schema.Build(context.Background(), s)
	require.NoError(t, err)
	ex := &exec.Executor{Session: s, Snapshot: func(context.Context) *schema.Snapshot { return snap }}
	res, err := ex.Run(context.Background(), exec.Request{CQL: "SELECT * FROM rowfmt_it." + table, Keyspace: "rowfmt_it", PageSize: 100})
	require.NoError(t, err)
	req := Request{Columns: res.Columns, Source: &Source{Keyspace: "rowfmt_it", Table: table}}
	for _, r := range res.Rows {
		var row []json.RawMessage
		for _, v := range r {
			b, err := json.Marshal(v)
			require.NoError(t, err)
			row = append(row, b)
		}
		req.Rows = append(req.Rows, row)
	}
	return req
}

// TestSQLInsertsRoundTrip re-executes the SQL Inserts text against a copy of the
// table and requires the same rows, then checks Where Clause finds each row.
func TestSQLInsertsRoundTrip(t *testing.T) {
	s := itSession(t)
	require.NoError(t, s.Query(`DROP KEYSPACE IF EXISTS rowfmt_it`).Exec())
	require.NoError(t, s.Query(`CREATE KEYSPACE rowfmt_it WITH replication = {'class':'SimpleStrategy','replication_factor':1}`).Exec())
	const ddl = `(id int, ck text, v text, n decimal, l list<int>, m map<text,int>, b blob, ts timestamp, d date, u uuid, PRIMARY KEY (id, ck))`
	require.NoError(t, s.Query(`CREATE TABLE rowfmt_it.src `+ddl).Exec())
	require.NoError(t, s.Query(`CREATE TABLE rowfmt_it.dst `+ddl).Exec())
	require.NoError(t, s.Query(`INSERT INTO rowfmt_it.src (id, ck, v, n, l, m, b, ts, d, u) VALUES (1, 'a', 'it''s, "quoted"
newline', 12.50, [1,2,3], {'k': 7}, 0x0aff, '2026-09-30 10:00:00+0000', '2026-09-30', 7c9e6679-7425-40de-944b-e07fc1f90ae7)`).Exec())
	require.NoError(t, s.Query(`INSERT INTO rowfmt_it.src (id, ck) VALUES (2, 'b')`).Exec())

	req := selectAll(t, s, "src")
	req.Format = "sql_inserts"
	text, err := Format(req)
	require.NoError(t, err)
	for _, stmt := range strings.Split(text, ";\n") {
		stmt = strings.TrimSuffix(stmt, ";")
		require.NoError(t, s.Query(strings.Replace(stmt, "rowfmt_it.src", "rowfmt_it.dst", 1)).Exec(), stmt)
	}
	got := selectAll(t, s, "dst")
	require.Equal(t, req.Rows, got.Rows)

	req.Format = "where"
	where, err := Format(req)
	require.NoError(t, err)
	for _, line := range strings.Split(where, "\n") {
		var n int
		require.NoError(t, s.Query("SELECT count(*) FROM rowfmt_it.src WHERE "+line).Scan(&n))
		require.Equal(t, 1, n, line)
	}
}

// TestSQLInRunsAgainstTable runs the generated `col IN (...)` text as a WHERE clause.
func TestSQLInRunsAgainstTable(t *testing.T) {
	s := itSession(t)
	require.NoError(t, s.Query(`DROP KEYSPACE IF EXISTS rowfmt_it`).Exec())
	require.NoError(t, s.Query(`CREATE KEYSPACE rowfmt_it WITH replication = {'class':'SimpleStrategy','replication_factor':1}`).Exec())
	require.NoError(t, s.Query(`CREATE TABLE rowfmt_it.inq (id int PRIMARY KEY, v text)`).Exec())
	for i, v := range []string{"a", "b", "b", "c"} {
		require.NoError(t, s.Query(`INSERT INTO rowfmt_it.inq (id, v) VALUES (?, ?)`, i+1, v).Exec())
	}
	req := selectAll(t, s, "inq")
	req.Format = "sql_in"
	text, err := Format(req)
	require.NoError(t, err)
	lines := strings.Split(text, "\n")
	require.Len(t, lines, 2)
	var n int
	require.NoError(t, s.Query("SELECT count(*) FROM rowfmt_it.inq WHERE "+lines[0]).Scan(&n))
	require.Equal(t, 4, n)
}
