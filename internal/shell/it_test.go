//go:build integration

package shell

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/0funct0ry/helenus/internal/cli"
	"github.com/0funct0ry/helenus/internal/config"
	"github.com/0funct0ry/helenus/internal/conn"
	"github.com/0funct0ry/helenus/internal/exec"
	"github.com/0funct0ry/helenus/internal/schema"
)

func itVersion() string {
	if v := os.Getenv("HELENUS_IT_CASSANDRA_VERSION"); v != "" {
		return v
	}
	return "4.1"
}

// address returns host and port of a node with MVs and UDFs enabled:
// HELENUS_IT_ADDR (host:port) if set, otherwise a fresh testcontainers node.
func address(t *testing.T) (string, int) {
	t.Helper()
	if addr := os.Getenv("HELENUS_IT_ADDR"); addr != "" {
		var host string
		var port int
		if _, err := fmt.Sscanf(strings.Replace(addr, ":", " ", 1), "%s %d", &host, &port); err != nil {
			t.Fatal(err)
		}
		return host, port
	}
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
	return h, int(mp.Num())
}

// itShell dials the node, retrying while it finishes starting.
func itShell(t *testing.T) (*Shell, *bytes.Buffer, *bytes.Buffer) {
	t.Helper()
	host, port := address(t)
	p := config.Profile{Hosts: []string{host}, Port: port, ConnectTimeout: "30s", RequestTimeout: "30s"}
	p.ApplyDefaults()
	mgr := conn.NewManager()
	t.Cleanup(mgr.CloseAll)
	var b *Backend
	var err error
	for i := 0; i < 40; i++ {
		if b, _, err = Dial(context.Background(), mgr, schema.NewCache(), "it", p); err == nil {
			break
		}
		time.Sleep(3 * time.Second)
	}
	if err != nil {
		t.Fatal(err)
	}
	var out, errOut bytes.Buffer
	return &Shell{Out: &out, Err: &errOut, Backend: *b, Format: "table", Paging: 100, Version: "it"}, &out, &errOut
}

func mustRun(t *testing.T, s *Shell, errOut *bytes.Buffer, script string) {
	t.Helper()
	if err := s.RunScript(context.Background(), "", script, ScriptOptions{AbortCode: 1}); err != nil {
		t.Fatalf("%v\n%s", err, errOut)
	}
}

// TestFixtureLoadsViaScript is `helenus -f testdata/fixture.cql` on an empty
// cluster (SPEC §8.6).
func TestFixtureLoadsViaScript(t *testing.T) {
	s, out, errOut := itShell(t)
	mustRun(t, s, errOut, "DROP KEYSPACE IF EXISTS payments;")
	data, err := os.ReadFile("../../testdata/fixture.cql")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.RunScript(context.Background(), "fixture.cql", string(data), ScriptOptions{}); err != nil {
		t.Fatalf("%v\n%s", err, errOut)
	}
	out.Reset()
	mustRun(t, s, errOut, "DESCRIBE TABLES;")
	if !strings.Contains(out.String(), "transactions_by_merchant") || !strings.Contains(out.String(), "merchants") {
		t.Errorf("DESCRIBE TABLES = %q", out)
	}
	// A failing statement aborts with exit code 4.
	err = s.RunScript(context.Background(), "bad.cql", "SELECT * FROM nope.nothing;\nSELECT 1;", ScriptOptions{})
	if cli.Code(err) != cli.ExitScript {
		t.Errorf("code = %d", cli.Code(err))
	}
}

// TestExecCodecRoundTrip writes every kind of fixture value with CQL literals
// and reads it back through the executor, the JSON encoder and the text renderer.
func TestExecCodecRoundTrip(t *testing.T) {
	s, out, errOut := itShell(t)
	mustRun(t, s, errOut, "DROP KEYSPACE IF EXISTS payments;")
	data, _ := os.ReadFile("../../testdata/fixture.cql")
	if err := s.RunScript(context.Background(), "fixture.cql", string(data), ScriptOptions{}); err != nil {
		t.Fatalf("%v\n%s", err, errOut)
	}
	mustRun(t, s, errOut, `
USE payments;
INSERT INTO merchants (merchant_id, name, billing, contacts, categories, nested) VALUES (
  11111111-1111-1111-1111-111111111111, 'Acme',
  {name: 'A', home: {street: '1 Main', city: 'X', country: 'US', postal_code: '1'}, points: [{lat: 1.5, lon: 2.5}]},
  {'hq': {street: 's', city: 'c', country: 'k', postal_code: 'p'}},
  {'a', 'b'}, {'k': [(1, 'x')]});
INSERT INTO transactions_by_merchant (merchant_id, txn_day, txn_time, merchant_name, amount, currency, status, tags, metadata, billing, history, geo, raw_payload)
  VALUES (11111111-1111-1111-1111-111111111111, '2026-03-01', 50554d6e-3a1b-11ee-be56-0242ac120002, 'M', 12.50, 'EUR', 'paid', {'t1'}, {'k': 'v'},
  {street: 's', city: 'c', country: 'k', postal_code: 'p'}, [1.5, 2.25], (1.5, 2.5), 0xdeadbeef);
UPDATE ledger_counters SET debits = debits + 5 WHERE account_id = 22222222-2222-2222-2222-222222222222 AND day = '2026-03-01';
`)

	// JSON side: decimal and counter are strings, collections and UDTs nest.
	res, err := s.Exec.Run(context.Background(), exec.Request{CQL: "SELECT amount, currency, tags, metadata, history, geo, raw_payload, merchant_name FROM transactions_by_merchant", Keyspace: "payments"})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Rows) != 1 {
		t.Fatalf("rows = %v", res.Rows)
	}
	if got := fmt.Sprint(res.Rows[0][0]); got != "12.50" {
		t.Errorf("amount = %v", res.Rows[0][0])
	}
	if res.Columns[0].Type.Name != "decimal" || res.Columns[7].Kind != "static" {
		t.Errorf("columns = %+v", res.Columns)
	}
	ctr, err := s.Exec.Run(context.Background(), exec.Request{CQL: "SELECT debits FROM ledger_counters", Keyspace: "payments"})
	if err != nil {
		t.Fatal(err)
	}
	if got, ok := ctr.Rows[0][0].(string); !ok || got != "5" {
		t.Errorf("counter = %#v", ctr.Rows[0][0])
	}

	// Text side, in each format.
	out.Reset()
	s.Format = "expanded"
	mustRun(t, s, errOut, "SELECT name, billing, contacts, categories, nested FROM payments.merchants;")
	for _, want := range []string{"@ Row 1", "Acme", "street: '1 Main'", "'a', 'b'", "(1, 'x')"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("expanded output missing %q:\n%s", want, out)
		}
	}
	out.Reset()
	s.Format = "table"
	mustRun(t, s, errOut, "SELECT currency, tags, metadata FROM payments.transactions_by_merchant;")
	if !strings.Contains(out.String(), "{'t1'}") || !strings.Contains(out.String(), "{'k': 'v'}") || !strings.Contains(out.String(), "(1 row)") {
		t.Errorf("table output:\n%s", out)
	}

	// raw output is header + rows, nothing else: `-e ... --format raw | wc -l`.
	for i := 0; i < 5; i++ {
		mustRun(t, s, errOut, fmt.Sprintf("INSERT INTO payments.merchants (merchant_id, name) VALUES (uuid(), 'm%d');", i))
	}
	out.Reset()
	s.Format = "raw"
	s.Paging = 2 // exercises client-side paging by page state
	mustRun(t, s, errOut, "SELECT merchant_id, name FROM payments.merchants WHERE name IN ('m0','m1','m2','m3','m4') ALLOW FILTERING;")
	if n := strings.Count(out.String(), "\n"); n != 6 {
		t.Errorf("raw lines = %d, want 6:\n%s", n, out)
	}

	// Filtering error carries the hint.
	errOut.Reset()
	s.Paging = 100
	err = s.RunScript(context.Background(), "", "SELECT * FROM payments.merchants WHERE name = 'm1';", ScriptOptions{AbortCode: 1})
	if cli.Code(err) != 1 || !strings.Contains(errOut.String(), "ALLOW FILTERING") {
		t.Errorf("err=%v stderr=%s", err, errOut)
	}

	// USE with a missing keyspace fails and keeps the current one.
	if err := s.Execute(context.Background(), "USE payments"); err != nil || s.Keyspace != "payments" {
		t.Errorf("USE: %v %q", err, s.Keyspace)
	}
	if err := s.Execute(context.Background(), "USE missing_ks"); err == nil || s.Keyspace != "payments" {
		t.Errorf("USE missing: %v %q", err, s.Keyspace)
	}
}
