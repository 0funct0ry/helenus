//go:build integration

package importer

import (
	"bufio"
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/dataio/detect"
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

func itTable(t *testing.T, s *gocql.Session, ks, name string) (schema.Table, codec.UDTFieldTypes) {
	t.Helper()
	snap, err := schema.Build(context.Background(), s)
	if err != nil {
		t.Fatal(err)
	}
	tbl := snap.Keyspace(ks).Table(name)
	if tbl == nil {
		t.Fatalf("table %s.%s missing", ks, name)
	}
	return *tbl, snap.UDTFields
}

func count(t *testing.T, s *gocql.Session, q string) int {
	t.Helper()
	var n int
	if err := s.Query(q).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// TestImportMillionRowsWithBadRows imports a generated CSV in which every
// 1,000th row has a bad key (0.1%), then checks the row count and that the
// error report names every rejected line.
func TestImportMillionRowsWithBadRows(t *testing.T) {
	s := itSession(t)
	for _, q := range []string{
		`CREATE KEYSPACE IF NOT EXISTS m917 WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}`,
		`DROP TABLE IF EXISTS m917.users`,
		`CREATE TABLE m917.users (user_id int PRIMARY KEY, email text, created_at timestamp)`,
	} {
		if err := s.Query(q).Exec(); err != nil {
			t.Fatal(err)
		}
	}
	tbl, udt := itTable(t, s, "m917", "users")
	rows := 1_000_000
	if v, err := strconv.Atoi(os.Getenv("HELENUS_IT_IMPORT_ROWS")); err == nil && v > 0 {
		rows = v
	}
	pr, pw := io.Pipe()
	go func() {
		w := bufio.NewWriterSize(pw, 1<<20)
		fmt.Fprint(w, "UserId;E-Mail;createdAt\n")
		for i := 1; i <= rows; i++ {
			id := strconv.Itoa(i)
			if i%1000 == 0 {
				id = "bad" + id
			}
			fmt.Fprintf(w, "%s;u%d@example.com;2024-01-02T03:04:05Z\n", id, i)
		}
		_ = w.Flush()
		pw.Close()
	}()
	rd, err := Open(pr, Format{Kind: detect.CSV, Delimiter: ";", Header: true})
	if err != nil {
		t.Fatal(err)
	}
	var errs strings.Builder
	job := Job{Table: tbl, UDT: udt, Opts: Options{Concurrency: 32},
		Mapping: []Mapping{{"user_id", "UserId"}, {"email", "E-Mail"}, {"created_at", "createdAt"}}}
	res, err := job.Run(context.Background(), sessExec{s}, rd, &errs, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	bad := rows / 1000
	if res.Written != int64(rows-bad) || res.Rejected != int64(bad) {
		t.Fatalf("%+v", res)
	}
	if n := count(t, s, `SELECT COUNT(*) FROM m917.users`); n != rows-bad {
		t.Fatalf("table has %d rows, want %d", n, rows-bad)
	}
	er := csv.NewReader(strings.NewReader(errs.String()))
	er.FieldsPerRecord = -1
	recs, err := er.ReadAll()
	if err != nil || len(recs) != bad+1 {
		t.Fatalf("%d error records, want %d (%v)", len(recs), bad+1, err)
	}
	// Line 1 is the header, so row i sits on line i+1.
	if recs[1][0] != "1001" || recs[1][1] != "user_id" || recs[1][2] != "bad1000" || !strings.Contains(recs[1][3], "integer") {
		t.Fatalf("first error: %v", recs[1])
	}
}

// TestImportNDJSONIntoUDT loads nested objects into a UDT column and a map, in batches of one partition.
func TestImportNDJSONIntoUDT(t *testing.T) {
	s := itSession(t)
	for _, q := range []string{
		`CREATE KEYSPACE IF NOT EXISTS m917 WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}`,
		`CREATE TYPE IF NOT EXISTS m917.address (street text, zip text)`,
		`DROP TABLE IF EXISTS m917.people`,
		`CREATE TABLE m917.people (id int, seq int, home frozen<address>, tags map<text,int>, PRIMARY KEY (id, seq))`,
	} {
		if err := s.Query(q).Exec(); err != nil {
			t.Fatal(err)
		}
	}
	tbl, udt := itTable(t, s, "m917", "people")
	data := `{"id":1,"seq":1,"home":{"street":"Main","zip":"1"},"tags":{"a":1}}
{"id":1,"seq":2,"home":{"street":"Side"},"tags":{}}
{"id":2,"seq":1,"home":null,"tags":{"b":2,"c":3}}
`
	rd, err := Open(strings.NewReader(data), Format{Kind: detect.NDJSON})
	if err != nil {
		t.Fatal(err)
	}
	var m []Mapping
	for _, c := range rd.Columns() {
		m = append(m, Mapping{c, c})
	}
	res, err := (Job{Table: tbl, UDT: udt, Mapping: m, Opts: Options{BatchSize: 10}}).Run(context.Background(), sessExec{s}, rd, nil, 0, nil)
	if err != nil || res.Written != 3 || res.Rejected != 0 {
		t.Fatalf("%+v %v", res, err)
	}
	var street string
	if err := s.Query(`SELECT home.street FROM m917.people WHERE id = 1 AND seq = 1`).Scan(&street); err != nil || street != "Main" {
		t.Fatalf("%q %v", street, err)
	}
	var tags map[string]int
	if err := s.Query(`SELECT tags FROM m917.people WHERE id = 2 AND seq = 1`).Scan(&tags); err != nil || len(tags) != 2 || tags["c"] != 3 {
		t.Fatalf("%v %v", tags, err)
	}
}
