//go:build integration

package mutate

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

func loadCQL(t *testing.T, s *gocql.Session, ks, file string) {
	t.Helper()
	_ = s.Query(`DROP KEYSPACE IF EXISTS ` + ks).Exec()
	b, err := os.ReadFile(file)
	require.NoError(t, err)
	for _, stmt := range strings.Split(string(b), ";\n") {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		require.NoError(t, s.Query(stmt).Exec(), stmt)
	}
}

type itEnv struct {
	t    *testing.T
	ex   *exec.Executor
	snap *schema.Snapshot
}

func newITEnv(t *testing.T) *itEnv {
	s := session(t)
	loadCQL(t, s, "payments", "../../testdata/fixture.cql")
	loadCQL(t, s, "labs", "testdata/mutate_fixture.cql")
	snap, err := schema.Build(context.Background(), s)
	require.NoError(t, err)
	return &itEnv{t: t, snap: snap, ex: &exec.Executor{Session: s, Snapshot: func(context.Context) *schema.Snapshot { return snap }}}
}

func (e *itEnv) outcomes(ks, table, changes string) []Outcome {
	e.t.Helper()
	var cs []Change
	require.NoError(e.t, json.Unmarshal([]byte(changes), &cs))
	stmts, err := Compile(e.snap, ks, table, cs)
	require.NoError(e.t, err)
	return Apply(context.Background(), e.ex.Run, stmts, Options{Consistency: "ONE"})
}

// apply runs changes and requires every one to succeed.
func (e *itEnv) apply(ks, table, changes string) {
	e.t.Helper()
	for _, o := range e.outcomes(ks, table, changes) {
		require.Equal(e.t, StatusApplied, o.Status, "change %d: %v\n%s", o.Index, o.Err, o.ExecutedCQL)
	}
}

// row reads one row back as column name → JSON text.
func (e *itEnv) row(cql string) map[string]string {
	e.t.Helper()
	res, err := e.ex.Run(context.Background(), exec.Request{CQL: cql, Consistency: "ONE"})
	require.NoError(e.t, err, cql)
	require.Len(e.t, res.Rows, 1, cql)
	out := map[string]string{}
	for i, c := range res.Columns {
		b, err := json.Marshal(res.Rows[0][i])
		require.NoError(e.t, err)
		out[c.Name] = string(b)
	}
	return out
}

func (e *itEnv) count(cql string) int {
	e.t.Helper()
	res, err := e.ex.Run(context.Background(), exec.Request{CQL: cql, Consistency: "ONE"})
	require.NoError(e.t, err, cql)
	return len(res.Rows)
}

const (
	pid     = `"7c9e6679-7425-40de-944b-e07fc1f90ae7"`
	profile = `SELECT * FROM labs.profiles WHERE id = 7c9e6679-7425-40de-944b-e07fc1f90ae7`
)

func TestScalarCellsRoundTrip(t *testing.T) {
	e := newITEnv(t)
	key := `{"id":` + pid + `}`
	e.apply("labs", "profiles", `[
		{"kind":"insert_row","values":{"id":`+pid+`,"note":"it's","big":"1208925819614629174706176"}},
		{"kind":"set_cell","key":`+key+`,"column":"since","value":"2026-09-30T10:00:00.005Z"},
		{"kind":"set_cell","key":`+key+`,"column":"ip","value":"10.0.0.1"},
		{"kind":"set_cell","key":`+key+`,"column":"span","value":"1mo2d3h4m"},
		{"kind":"set_cell","key":`+key+`,"column":"at","value":"01:02:03.000000004"},
		{"kind":"set_cell","key":`+key+`,"column":"born","value":"2026-09-30"},
		{"kind":"set_cell","key":`+key+`,"column":"ratio","value":0.25},
		{"kind":"set_cell","key":`+key+`,"column":"price","value":"-Infinity"},
		{"kind":"set_cell","key":`+key+`,"column":"flag","value":true}]`)
	r := e.row(profile)
	require.Equal(t, `"it's"`, r["note"])
	require.Equal(t, `"1208925819614629174706176"`, r["big"])
	require.Equal(t, `"2026-09-30T10:00:00.005Z"`, r["since"])
	require.Equal(t, `"10.0.0.1"`, r["ip"])
	require.Equal(t, `"1mo2d3h4m"`, r["span"])
	require.Equal(t, `"01:02:03.000000004"`, r["at"])
	require.Equal(t, `"2026-09-30"`, r["born"])
	require.Equal(t, `0.25`, r["ratio"])
	require.Equal(t, `"-Infinity"`, r["price"])
	require.Equal(t, `true`, r["flag"])

	e.apply("labs", "profiles", `[{"kind":"set_null","key":`+key+`,"column":"note"},{"kind":"set_null","key":`+key+`,"column":"big"}]`)
	r = e.row(profile)
	require.Equal(t, `null`, r["note"])
	require.Equal(t, `null`, r["big"])
	require.Equal(t, `true`, r["flag"], "clearing one cell leaves the others")

	e.apply("labs", "profiles", `[{"kind":"delete_row","key":`+key+`}]`)
	require.Zero(t, e.count(profile))
}

func TestCollectionElementOperations(t *testing.T) {
	e := newITEnv(t)
	key := `{"id":` + pid + `}`
	e.apply("labs", "profiles", `[
		{"kind":"insert_row","values":{"id":`+pid+`,"nicks":["b"],"scores":[1,2],"attrs":[["a",1]]}},
		{"kind":"list_append","key":`+key+`,"column":"nicks","value":["c"]},
		{"kind":"list_prepend","key":`+key+`,"column":"nicks","value":["a"]},
		{"kind":"set_add","key":`+key+`,"column":"scores","value":[3]},
		{"kind":"map_put","key":`+key+`,"column":"attrs","map_key":"b","value":2}]`)
	r := e.row(profile)
	require.Equal(t, `["a","b","c"]`, r["nicks"])
	require.Equal(t, `[1,2,3]`, r["scores"])
	require.Equal(t, `[["a",1],["b",2]]`, r["attrs"])

	e.apply("labs", "profiles", `[
		{"kind":"list_set_index","key":`+key+`,"column":"nicks","index":1,"value":"B"},
		{"kind":"list_remove_index","key":`+key+`,"column":"nicks","index":0},
		{"kind":"set_remove","key":`+key+`,"column":"scores","value":[1]},
		{"kind":"map_remove","key":`+key+`,"column":"attrs","map_key":"a"}]`)
	r = e.row(profile)
	require.Equal(t, `["B","c"]`, r["nicks"])
	require.Equal(t, `[2,3]`, r["scores"])
	require.Equal(t, `[["b",2]]`, r["attrs"])

	e.apply("labs", "profiles", `[{"kind":"replace_value","key":`+key+`,"column":"scores","value":[9]},
		{"kind":"replace_value","key":`+key+`,"column":"blob_keys","value":[["0x01",1],["0x02",2]]},
		{"kind":"map_put","key":`+key+`,"column":"blob_keys","map_key":"0x03","value":3}]`)
	r = e.row(profile)
	require.Equal(t, `[9]`, r["scores"])
	require.Equal(t, `[["0x01",1],["0x02",2],["0x03",3]]`, r["blob_keys"])
}

func TestUDTChanges(t *testing.T) {
	e := newITEnv(t)
	key := `{"id":` + pid + `}`
	e.apply("labs", "profiles", `[
		{"kind":"insert_row","values":{"id":`+pid+`,"contact":{"city":"Pune","visits":"1"}}},
		{"kind":"udt_field_set","key":`+key+`,"column":"contact","field":"city","value":"Mumbai"},
		{"kind":"udt_field_set","key":`+key+`,"column":"contact","field":"visits","value":"9007199254740993"}]`)
	var contact map[string]any
	require.NoError(t, json.Unmarshal([]byte(e.row(profile)["contact"]), &contact))
	require.Equal(t, "Mumbai", contact["city"])
	require.Equal(t, "9007199254740993", contact["visits"])

	e.apply("labs", "profiles", `[{"kind":"replace_value","key":`+key+`,"column":"contact","value":{"id":`+pid+`,"city":"Delhi","visits":"2"}}]`)
	require.JSONEq(t, `{"city":"Delhi","id":`+pid+`,"visits":"2"}`, e.row(profile)["contact"])
}

func TestFixtureTables(t *testing.T) {
	e := newITEnv(t)
	merchant, day, txn := `"7c9e6679-7425-40de-944b-e07fc1f90ae7"`, `"2026-09-30"`, `"3f1a2b10-9d3c-11ef-8a6e-0242ac120002"`
	key := `{"merchant_id":` + merchant + `,"txn_day":` + day + `,"txn_time":` + txn + `}`
	const tx = `SELECT * FROM payments.transactions_by_merchant WHERE merchant_id = 7c9e6679-7425-40de-944b-e07fc1f90ae7 AND txn_day = '2026-09-30'`

	e.apply("payments", "transactions_by_merchant", `[
		{"kind":"insert_row","values":{"merchant_id":`+merchant+`,"txn_day":`+day+`,"txn_time":`+txn+`,"amount":"1180.00","status":"new","tags":["a"],"billing":{"city":"Pune"}}},
		{"kind":"set_cell","key":`+key+`,"column":"amount","value":"1250.00"},
		{"kind":"set_add","key":`+key+`,"column":"tags","value":["vip"]},
		{"kind":"set_cell","key":`+key+`,"column":"merchant_name","value":"Acme"},
		{"kind":"set_cell","key":`+key+`,"column":"geo","value":[18.5,73.8]},
		{"kind":"replace_value","key":`+key+`,"column":"billing","value":{"city":"Mumbai","street":"1 Main St"}}]`)
	r := e.row(tx)
	require.Equal(t, `"1250.00"`, r["amount"])
	require.Equal(t, `["a","vip"]`, r["tags"])
	require.Equal(t, `"Acme"`, r["merchant_name"])
	require.Equal(t, `[18.5,73.8]`, r["geo"])
	var billing map[string]any // the driver reads unset UDT fields as zero values
	require.NoError(t, json.Unmarshal([]byte(r["billing"]), &billing))
	require.Equal(t, "Mumbai", billing["city"])
	require.Equal(t, "1 Main St", billing["street"])

	// A static cell is keyed by the partition key only, so a second row sees it too.
	e.apply("payments", "transactions_by_merchant", `[
		{"kind":"insert_row","values":{"merchant_id":`+merchant+`,"txn_day":`+day+`,"txn_time":"3f1a2b10-9d3c-11ef-8a6e-0242ac120003","status":"second"}}]`)
	require.Equal(t, 2, e.count(tx))

	e.apply("payments", "transactions_by_merchant", `[{"kind":"delete_row","key":`+key+`}]`)
	require.Equal(t, 1, e.count(tx))
}

func TestCounters(t *testing.T) {
	e := newITEnv(t)
	key := `{"account_id":` + pid + `,"day":"2026-09-30"}`
	const q = `SELECT * FROM payments.ledger_counters WHERE account_id = 7c9e6679-7425-40de-944b-e07fc1f90ae7 AND day = '2026-09-30'`
	e.apply("payments", "ledger_counters", `[
		{"kind":"counter_delta","key":`+key+`,"column":"debits","value":5},
		{"kind":"counter_delta","key":`+key+`,"column":"debits","value":"-2"},
		{"kind":"counter_delta","key":`+key+`,"column":"credits","value":10}]`)
	r := e.row(q)
	require.Equal(t, `"3"`, r["debits"])
	require.Equal(t, `"10"`, r["credits"])
}

func TestInsertIfNotExistsConflictStopsTheRun(t *testing.T) {
	e := newITEnv(t)
	key := `{"id":` + pid + `}`
	e.apply("labs", "profiles", `[{"kind":"insert_row","values":{"id":`+pid+`,"note":"first"}}]`)

	out := e.outcomes("labs", "profiles", `[
		{"kind":"set_cell","key":`+key+`,"column":"note","value":"second"},
		{"kind":"insert_row","if_not_exists":true,"values":{"id":`+pid+`,"note":"dupe"}},
		{"kind":"set_cell","key":`+key+`,"column":"note","value":"third"}]`)
	require.Equal(t, StatusApplied, out[0].Status)
	require.Equal(t, StatusFailed, out[1].Status)
	require.ErrorIs(t, out[1].Err, ErrNotApplied)
	require.Equal(t, StatusPending, out[2].Status)
	require.Equal(t, `"second"`, e.row(profile)["note"], "the third change must not have run")
}

func TestServerRejectionStopsTheRun(t *testing.T) {
	e := newITEnv(t)
	key := `{"id":` + pid + `}`
	e.apply("labs", "profiles", `[{"kind":"insert_row","values":{"id":`+pid+`,"nicks":["only"]}}]`)
	out := e.outcomes("labs", "profiles", `[
		{"kind":"list_set_index","key":`+key+`,"column":"nicks","index":5,"value":"x"},
		{"kind":"set_cell","key":`+key+`,"column":"note","value":"never"}]`)
	require.Equal(t, StatusFailed, out[0].Status, "setting an index past the end of the list is rejected")
	require.Error(t, out[0].Err)
	require.Equal(t, StatusPending, out[1].Status)
	require.Equal(t, `null`, e.row(profile)["note"])
}
