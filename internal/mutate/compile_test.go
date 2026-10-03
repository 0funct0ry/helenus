package mutate

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/schema"
)

var update = flag.Bool("update", false, "rewrite golden files")

func col(ks, name, typ, kind string, pos int) schema.Column {
	td, err := codec.Parse(typ, ks)
	if err != nil {
		panic(err)
	}
	return schema.Column{Name: name, CQL: typ, Type: td, Kind: kind, Position: pos}
}

func udt(ks, name string, fields ...[2]string) schema.UDT {
	u := schema.UDT{Keyspace: ks, Name: name}
	for _, f := range fields {
		td, err := codec.Parse(f[1], ks)
		if err != nil {
			panic(err)
		}
		u.Fields = append(u.Fields, schema.Field{Name: f[0], Type: td, CQL: f[1]})
	}
	return u
}

// snapshot mirrors testdata/fixture.cql (payments) plus a labs keyspace with the
// shapes the fixture lacks: a non-frozen UDT, non-frozen collections, varint.
func snapshot() *schema.Snapshot {
	p, l := "payments", "labs"
	pay := schema.Keyspace{Name: p,
		Types: []schema.UDT{
			udt(p, "address", [2]string{"street", "text"}, [2]string{"city", "text"}, [2]string{"country", "text"}, [2]string{"postal_code", "text"}),
			udt(p, "geo_point", [2]string{"lat", "double"}, [2]string{"lon", "double"}),
		},
		Tables: []schema.Table{
			{Keyspace: p, Name: "transactions_by_merchant", Columns: []schema.Column{
				col(p, "merchant_id", "uuid", schema.KindPartition, 1),
				col(p, "txn_day", "date", schema.KindPartition, 2),
				col(p, "txn_time", "timeuuid", schema.KindClustering, 1),
				col(p, "merchant_name", "text", schema.KindStatic, 0),
				col(p, "amount", "decimal", schema.KindRegular, 0),
				col(p, "status", "text", schema.KindRegular, 0),
				col(p, "tags", "set<text>", schema.KindRegular, 0),
				col(p, "metadata", "map<text, text>", schema.KindRegular, 0),
				col(p, "billing", "frozen<address>", schema.KindRegular, 0),
				col(p, "history", "list<decimal>", schema.KindRegular, 0),
				col(p, "geo", "frozen<tuple<double, double>>", schema.KindRegular, 0),
				col(p, "raw_payload", "blob", schema.KindRegular, 0),
			}},
			{Keyspace: p, Name: "ledger_counters", Counter: true, Columns: []schema.Column{
				col(p, "account_id", "uuid", schema.KindPartition, 1),
				col(p, "day", "date", schema.KindClustering, 1),
				col(p, "debits", "counter", schema.KindRegular, 0),
				col(p, "credits", "counter", schema.KindRegular, 0),
			}},
		},
		Views: []schema.View{{Keyspace: p, Name: "transactions_by_status", BaseTable: "transactions_by_merchant"}},
	}
	lab := schema.Keyspace{Name: l,
		Types: []schema.UDT{udt(l, "contact", [2]string{"id", "uuid"}, [2]string{"city", "text"}, [2]string{"visits", "bigint"})},
		Tables: []schema.Table{
			{Keyspace: l, Name: "profiles", Columns: []schema.Column{
				col(l, "id", "uuid", schema.KindPartition, 1),
				col(l, "contact", "contact", schema.KindRegular, 0),
				col(l, "nicks", "list<text>", schema.KindRegular, 0),
				col(l, "scores", "set<int>", schema.KindRegular, 0),
				col(l, "attrs", "map<text, int>", schema.KindRegular, 0),
				col(l, "blob_keys", "map<blob, int>", schema.KindRegular, 0),
				col(l, "big", "varint", schema.KindRegular, 0),
				col(l, "since", "timestamp", schema.KindRegular, 0),
				col(l, "ip", "inet", schema.KindRegular, 0),
			}},
		},
	}
	return &schema.Snapshot{Version: "5.0", Keyspaces: []schema.Keyspace{pay, lab, {Name: "system", System: true,
		Tables: []schema.Table{{Keyspace: "system", Name: "local", Columns: []schema.Column{col("system", "key", "text", schema.KindPartition, 1)}}}}}}
}

const (
	txKey = `{"merchant_id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","txn_day":"2026-09-30","txn_time":"3f1a2b10-9d3c-11ef-8a6e-0242ac120002"}`
	txPK  = `{"merchant_id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","txn_day":"2026-09-30"}`
	prKey = `{"id":"7c9e6679-7425-40de-944b-e07fc1f90ae7"}`
)

type goldenCase struct {
	name, ks, table, changes string
}

func goldenCases() []goldenCase {
	tx := func(name, change string) goldenCase {
		return goldenCase{name, "payments", "transactions_by_merchant", change}
	}
	pr := func(name, change string) goldenCase { return goldenCase{name, "labs", "profiles", change} }
	return []goldenCase{
		tx("set_cell_text", `[{"kind":"set_cell","key":`+txKey+`,"column":"status","value":"it's settled"}]`),
		tx("set_cell_decimal", `[{"kind":"set_cell","key":`+txKey+`,"column":"amount","value":"1250.00"}]`),
		tx("set_cell_blob", `[{"kind":"set_cell","key":`+txKey+`,"column":"raw_payload","value":"0xcafe"}]`),
		tx("set_cell_frozen_tuple", `[{"kind":"set_cell","key":`+txKey+`,"column":"geo","value":[18.5,73.8]}]`),
		tx("set_cell_static", `[{"kind":"set_cell","key":`+txKey+`,"column":"merchant_name","value":"Acme"}]`),
		tx("set_null", `[{"kind":"set_null","key":`+txKey+`,"column":"status"}]`),
		tx("set_null_static", `[{"kind":"set_null","key":`+txKey+`,"column":"merchant_name"}]`),
		tx("insert_row", `[{"kind":"insert_row","values":{"merchant_id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","txn_day":"2026-09-30","txn_time":"3f1a2b10-9d3c-11ef-8a6e-0242ac120002","amount":"9.99","status":"new","tags":["a","b"],"metadata":[["k","v"]],"billing":{"city":"Pune","country":null},"raw_payload":null}}]`),
		tx("insert_row_if_not_exists", `[{"kind":"insert_row","if_not_exists":true,"values":{"merchant_id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","txn_day":"2026-09-30","txn_time":"3f1a2b10-9d3c-11ef-8a6e-0242ac120002","status":"new"}}]`),
		tx("delete_row", `[{"kind":"delete_row","key":`+txKey+`}]`),
		tx("set_add", `[{"kind":"set_add","key":`+txKey+`,"column":"tags","value":["vip","eu"]}]`),
		tx("set_remove", `[{"kind":"set_remove","key":`+txKey+`,"column":"tags","value":["old"]}]`),
		tx("map_put", `[{"kind":"map_put","key":`+txKey+`,"column":"metadata","map_key":"channel","value":"pos"}]`),
		tx("map_remove", `[{"kind":"map_remove","key":`+txKey+`,"column":"metadata","map_key":"channel"}]`),
		tx("list_append", `[{"kind":"list_append","key":`+txKey+`,"column":"history","value":["1.5"]}]`),
		tx("list_prepend", `[{"kind":"list_prepend","key":`+txKey+`,"column":"history","value":["0.5"]}]`),
		tx("list_set_index", `[{"kind":"list_set_index","key":`+txKey+`,"column":"history","index":1,"value":"2.5"}]`),
		tx("list_remove_index", `[{"kind":"list_remove_index","key":`+txKey+`,"column":"history","index":0}]`),
		tx("replace_non_frozen_set", `[{"kind":"replace_value","key":`+txKey+`,"column":"tags","value":["x"]}]`),
		tx("replace_frozen_udt", `[{"kind":"replace_value","key":`+txKey+`,"column":"billing","value":{"city":"Pune","street":"1 Main St"}}]`),
		tx("multi_change_order", `[{"kind":"set_cell","key":`+txKey+`,"column":"status","value":"a"},{"kind":"delete_row","key":`+txKey+`},{"kind":"set_null","key":`+txKey+`,"column":"amount"}]`),
		goldenCase{"counter_increment", "payments", "ledger_counters", `[{"kind":"counter_delta","key":{"account_id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","day":"2026-09-30"},"column":"debits","value":5}]`},
		goldenCase{"counter_decrement", "payments", "ledger_counters", `[{"kind":"counter_delta","key":{"account_id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","day":"2026-09-30"},"column":"credits","value":"-3"}]`},
		pr("udt_field_text", `[{"kind":"udt_field_set","key":`+prKey+`,"column":"contact","field":"city","value":"Pune"}]`),
		pr("udt_field_bigint_uuid", `[{"kind":"udt_field_set","key":`+prKey+`,"column":"contact","field":"visits","value":"9007199254740993"},{"kind":"udt_field_set","key":`+prKey+`,"column":"contact","field":"id","value":"7c9e6679-7425-40de-944b-e07fc1f90ae7"}]`),
		pr("replace_non_frozen_udt", `[{"kind":"replace_value","key":`+prKey+`,"column":"contact","value":{"id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","city":"Pune","visits":"3"}}]`),
		pr("set_cell_varint_inet_timestamp", `[{"kind":"set_cell","key":`+prKey+`,"column":"big","value":"1208925819614629174706176"},{"kind":"set_cell","key":`+prKey+`,"column":"ip","value":"10.0.0.1"},{"kind":"set_cell","key":`+prKey+`,"column":"since","value":"2026-09-30T10:00:00.005Z"}]`),
		pr("map_put_blob_key", `[{"kind":"map_put","key":`+prKey+`,"column":"blob_keys","map_key":"0xcafe","value":1}]`),
		pr("replace_map_blob_keys", `[{"kind":"replace_value","key":`+prKey+`,"column":"blob_keys","value":[["0x01",1],["0x02",2]]}]`),
		pr("set_add_ints", `[{"kind":"set_add","key":`+prKey+`,"column":"scores","value":[3,1]}]`),
		pr("list_append_text", `[{"kind":"list_append","key":`+prKey+`,"column":"nicks","value":["o'neil"]}]`),
	}
}

func render(stmts []Statement) string {
	var b strings.Builder
	for _, s := range stmts {
		fmt.Fprintf(&b, "-- %d %s: %s\ncql:     %s\npreview: %s\nargs:   ", s.Index, s.Kind, s.Summary, s.CQL, s.Preview)
		for _, a := range s.Args {
			fmt.Fprintf(&b, " %T(%v)", a, a)
		}
		b.WriteString("\n\n")
	}
	return b.String()
}

func TestCompileGolden(t *testing.T) {
	snap := snapshot()
	for _, c := range goldenCases() {
		t.Run(c.name, func(t *testing.T) {
			var changes []Change
			require.NoError(t, json.Unmarshal([]byte(c.changes), &changes))
			stmts, err := Compile(snap, c.ks, c.table, changes)
			require.NoError(t, err)
			got := render(stmts)
			path := filepath.Join("testdata", "golden", c.name+".golden")
			if *update {
				require.NoError(t, os.WriteFile(path, []byte(got), 0o644))
			}
			want, err := os.ReadFile(path)
			require.NoError(t, err, "run `make golden-mutate` to create it")
			require.Equal(t, string(want), got)
		})
	}
}

func compileErr(t *testing.T, ks, table, changes string) string {
	t.Helper()
	var cs []Change
	require.NoError(t, json.Unmarshal([]byte(changes), &cs))
	_, err := Compile(snapshot(), ks, table, cs)
	require.Error(t, err)
	return err.Error()
}

func TestCompileRules(t *testing.T) {
	cases := []struct {
		name, ks, table, changes, want string
	}{
		{"pk cell is read-only", "payments", "transactions_by_merchant", `[{"kind":"set_cell","key":` + txKey + `,"column":"txn_day","value":"2026-10-01"}]`, "primary key"},
		{"incomplete key", "payments", "transactions_by_merchant", `[{"kind":"set_cell","key":` + txPK + `,"column":"status","value":"x"}]`, "txn_time is missing"},
		{"unknown column", "payments", "transactions_by_merchant", `[{"kind":"set_null","key":` + txKey + `,"column":"nope"}]`, "no column"},
		{"insert needs the key", "payments", "transactions_by_merchant", `[{"kind":"insert_row","values":{"status":"x"}}]`, "merchant_id is required"},
		{"counter table rejects insert", "payments", "ledger_counters", `[{"kind":"insert_row","values":{}}]`, "counter tables"},
		{"counter table rejects delete", "payments", "ledger_counters", `[{"kind":"delete_row","key":{}}]`, "counter tables"},
		{"counter cell takes deltas only", "payments", "transactions_by_merchant", `[{"kind":"counter_delta","key":` + txKey + `,"column":"status","value":1}]`, "not a counter"},
		{"frozen udt rejects field set", "payments", "transactions_by_merchant", `[{"kind":"udt_field_set","key":` + txKey + `,"column":"billing","field":"city","value":"x"}]`, "frozen"},
		{"tuple rejects element ops", "payments", "transactions_by_merchant", `[{"kind":"list_append","key":` + txKey + `,"column":"geo","value":[1]}]`, "not a list"},
		{"set op on a list", "payments", "transactions_by_merchant", `[{"kind":"set_add","key":` + txKey + `,"column":"history","value":["1"]}]`, "not a set"},
		{"null set_cell", "payments", "transactions_by_merchant", `[{"kind":"set_cell","key":` + txKey + `,"column":"status","value":null}]`, "set_null"},
		{"bad value", "payments", "transactions_by_merchant", `[{"kind":"set_cell","key":` + txKey + `,"column":"amount","value":"abc"}]`, "decimal"},
		{"bad key value", "payments", "transactions_by_merchant", `[{"kind":"delete_row","key":{"merchant_id":"nope","txn_day":"2026-09-30","txn_time":"3f1a2b10-9d3c-11ef-8a6e-0242ac120002"}}]`, "UUID"},
		{"unknown udt field", "labs", "profiles", `[{"kind":"udt_field_set","key":` + prKey + `,"column":"contact","field":"zip","value":"1"}]`, "no field"},
		{"missing list index", "labs", "profiles", `[{"kind":"list_set_index","key":` + prKey + `,"column":"nicks","value":"x"}]`, "index"},
		{"unknown kind", "labs", "profiles", `[{"kind":"explode"}]`, "unknown change kind"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			require.Contains(t, compileErr(t, c.ks, c.table, c.changes), c.want)
		})
	}
}

func TestCompileReportsEveryBadChange(t *testing.T) {
	var cs []Change
	require.NoError(t, json.Unmarshal([]byte(`[
		{"kind":"set_null","key":`+prKey+`,"column":"nicks"},
		{"kind":"set_null","key":`+prKey+`,"column":"nope"},
		{"kind":"set_null","key":`+prKey+`,"column":"id"}]`), &cs))
	_, err := Compile(snapshot(), "labs", "profiles", cs)
	var ve *ValidationError
	require.True(t, errors.As(err, &ve))
	require.Len(t, ve.Errors, 2)
	require.Equal(t, 1, ve.Errors[0].Index)
	require.Equal(t, 2, ve.Errors[1].Index)
}

func TestCompileTableLevelRules(t *testing.T) {
	snap := snapshot()
	_, err := Compile(snap, "payments", "transactions_by_status", nil)
	var ro *ReadOnlyError
	require.True(t, errors.As(err, &ro))
	require.Contains(t, ro.Error(), "materialized view")

	_, err = Compile(snap, "system", "local", nil)
	require.True(t, errors.As(err, &ro))
	require.Contains(t, ro.Error(), "system")

	_, err = Compile(snap, "payments", "nope", nil)
	require.ErrorIs(t, err, ErrTableNotFound)
	_, err = Compile(snap, "nope", "t", nil)
	require.ErrorIs(t, err, ErrTableNotFound)
	_, err = Compile(nil, "a", "b", nil)
	require.ErrorIs(t, err, ErrTableNotFound)
}
