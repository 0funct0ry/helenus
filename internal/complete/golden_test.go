package complete

import (
	"context"
	"strings"
	"testing"

	"github.com/0funct0ry/helenus/internal/schema"
)

func col(name, typ, kind string, pos int, order string) schema.Column {
	return schema.Column{Name: name, CQL: typ, Kind: kind, Position: pos, Order: order}
}

// fixtureSnapshot mirrors testdata/fixture.cql plus a mixed-case keyspace.
func fixtureSnapshot() *schema.Snapshot {
	pay := schema.Keyspace{
		Name: "payments",
		Tables: []schema.Table{
			{Keyspace: "payments", Name: "transactions_by_merchant", Views: []string{"transactions_by_status"},
				Indexes: []schema.Index{{Name: "txn_by_currency", Column: "currency"}},
				Columns: []schema.Column{
					col("merchant_id", "uuid", schema.KindPartition, 1, ""), col("txn_day", "date", schema.KindPartition, 2, ""),
					col("txn_time", "timeuuid", schema.KindClustering, 1, "DESC"), col("merchant_name", "text", schema.KindStatic, 0, ""),
					col("amount", "decimal", schema.KindRegular, 0, ""), col("currency", "text", schema.KindRegular, 0, ""),
					col("status", "text", schema.KindRegular, 0, ""),
				}},
			{Keyspace: "payments", Name: "ledger_counters", Columns: []schema.Column{
				col("account_id", "uuid", schema.KindPartition, 1, ""), col("day", "date", schema.KindClustering, 1, "DESC"),
				col("debits", "counter", schema.KindRegular, 0, ""), col("credits", "counter", schema.KindRegular, 0, ""),
			}},
			{Keyspace: "payments", Name: "merchants", Columns: []schema.Column{
				col("merchant_id", "uuid", schema.KindPartition, 1, ""), col("name", "text", schema.KindRegular, 0, ""),
				col("billing", "frozen<billing_profile>", schema.KindRegular, 0, ""),
			}},
		},
		Views: []schema.View{{Keyspace: "payments", Name: "transactions_by_status", BaseTable: "transactions_by_merchant", Columns: []schema.Column{
			col("status", "text", schema.KindPartition, 1, ""), col("merchant_id", "uuid", schema.KindClustering, 1, "ASC"),
			col("txn_day", "date", schema.KindClustering, 2, "ASC"), col("amount", "decimal", schema.KindRegular, 0, ""),
		}}},
		Types:      []schema.UDT{{Keyspace: "payments", Name: "address"}, {Keyspace: "payments", Name: "geo_point"}, {Keyspace: "payments", Name: "billing_profile"}},
		Functions:  []schema.Function{{Keyspace: "payments", Name: "add_cents", ReturnType: "int"}},
		Aggregates: []schema.Aggregate{{Keyspace: "payments", Name: "sum_cents", ReturnType: "int"}},
	}
	shop := schema.Keyspace{
		Name: "shop",
		Tables: []schema.Table{
			{Keyspace: "shop", Name: "Orders", Columns: []schema.Column{
				col("OrderID", "uuid", schema.KindPartition, 1, ""), col("total", "decimal", schema.KindRegular, 0, ""),
			}},
			{Keyspace: "shop", Name: "order_items", Columns: []schema.Column{
				col("order_id", "uuid", schema.KindPartition, 1, ""), col("sku", "text", schema.KindClustering, 1, "ASC"),
			}},
		},
	}
	return &schema.Snapshot{Version: "5.0", Keyspaces: []schema.Keyspace{pay, shop, {Name: "system", System: true}}}
}

const merch = "SELECT * FROM payments.transactions_by_merchant "

type goldenCase struct {
	in   string // statement text; | marks the cursor
	ks   string // current keyspace; payments when empty
	want string // comma-separated labels: a leading "=" demands exactly this list, otherwise these must lead the result
}

var goldenCases = []goldenCase{
	// Statement start and meta-commands.
	{in: "|", want: "SELECT,INSERT,UPDATE,DELETE,BEGIN,CREATE,ALTER,DROP,TRUNCATE,GRANT,REVOKE,LIST"},
	{in: "sel|", want: "=SELECT"},
	{in: "SEL|ECT 1", want: "=SELECT"},
	{in: "SELECT 1; |", want: "SELECT,INSERT"},
	{in: "SELECT 1;|", want: "SELECT,INSERT"},
	{in: "de|", want: "=DELETE"},
	{in: ".|", want: ".consistency,.serial,.use,.describe"},
	{in: ".de|", want: "=.describe,.desc"},
	{in: ":pro|", want: "="},
	{in: "-- sel|", want: "="},
	{in: "-- note\n|", want: "SELECT"},
	{in: "SELECT 'a|", want: "="},
	{in: "/* sel|", want: "="},
	{in: ".consistency |", want: "=ANY,ONE,TWO,THREE,QUORUM,ALL,LOCAL_QUORUM,EACH_QUORUM,LOCAL_ONE"},
	{in: ".consistency LOCAL_|", want: "=LOCAL_QUORUM,LOCAL_ONE"},
	{in: ".consistency q|", want: "=QUORUM"},
	{in: "USE payments; .consistency |", want: "ANY,ONE"},
	{in: ".serial |", want: "=CONSISTENCY"},
	{in: ".serial CONSISTENCY |", want: "=SERIAL,LOCAL_SERIAL"},
	{in: ".format |", want: "=table,expanded,raw"},
	{in: ".expand |", want: "=ON,OFF"},
	{in: ".paging |", want: "=ON,OFF"},
	{in: ".tracing |", want: "=ON,OFF"},
	{in: ".show |", want: "=VERSION,HOST"},
	{in: ".help |", want: "consistency,serial,use,describe"},
	{in: "USE |", want: "=payments,shop,system"},
	{in: "USE sh|", want: "=shop"},

	// DESCRIBE.
	{in: ".describe |", want: "CLUSTER,KEYSPACES,KEYSPACE"},
	{in: ".desc KEYSPACE |", want: "=payments,shop,system"},
	{in: ".describe TABLE payments.|", want: "=transactions_by_merchant,ledger_counters,merchants"},
	{in: ".describe TYPE |", want: "payments,shop,system,address"},
	{in: ".describe MATERIALIZED VIEW payments.|", want: "=transactions_by_status"},
	{in: ".describe FULL |", want: "=SCHEMA"},
	{in: ".describe shop.|", want: "=Orders,order_items"},
	{in: ".desc payments.m|", want: "=merchants"},
	{in: ".describe INDEX payments.|", want: "=txn_by_currency"},
	{in: ".describe FUNCTION payments.|", want: "=add_cents"},

	// SELECT list.
	{in: "SELECT | FROM payments.transactions_by_merchant", want: "merchant_id,txn_day,txn_time,merchant_name"},
	{in: "SELECT mer| FROM payments.transactions_by_merchant", want: "=merchant_id,merchant_name"},
	{in: "SELECT * |", want: "=FROM,AS"},
	{in: "SELECT a, | FROM merchants", want: "merchant_id,name"},
	{in: "SELECT JSON | FROM merchants", want: "merchant_id,name"},
	{in: "SELECT writetime(|) FROM payments.merchants", want: "merchant_id,name"},
	{in: "SELECT count(*) |", want: "=FROM,AS"},
	{in: "SELECT |", want: "now(),uuid()"},
	{in: "SELECT D|", want: "=DISTINCT"},
	{in: "SELECT name FROM merchants WHERE merchant_id = 1; SELECT | FROM ledger_counters", want: "account_id,day,debits,credits"},

	// FROM targets.
	{in: "SELECT * FROM |", want: "payments,shop,system,transactions_by_merchant"},
	{in: "SELECT * FROM tra|", want: "=transactions_by_merchant,transactions_by_status"},
	{in: "SELECT * FROM payments.|", want: "=transactions_by_merchant,ledger_counters,merchants,transactions_by_status"},
	{in: "SELECT * FROM payments.m|", want: "=merchants"},
	{in: "SELECT * FROM shop.|", want: "=Orders,order_items"},
	{in: "SELECT * FROM shop.o|", want: "=Orders,order_items"},
	{in: `SELECT * FROM "shop"."O|`, want: "=Orders"},
	{in: `SELECT * FROM "sh|`, want: "=shop"},
	{in: "SELECT * FROM |", ks: "shop", want: "payments,shop,system,Orders,order_items"},
	{in: "SELECT * FROM |", ks: "-", want: "=payments,shop,system"},
	{in: "SELECT * FROM unknown.|", want: "="},

	// After the target.
	{in: "SELECT * FROM merchants |", want: "=WHERE,GROUP BY,ORDER BY,PER PARTITION LIMIT,LIMIT,ALLOW FILTERING"},

	// WHERE.
	{in: merch + "WHERE |", want: "merchant_id,txn_day,txn_time"},
	{in: merch + "WHERE merchant_id = ? AND |", want: "merchant_id,txn_day,txn_time"},
	{in: merch + "WHERE merchant_id |", want: "=IN,CONTAINS,CONTAINS KEY,LIKE,IS NOT NULL"},
	{in: merch + "WHERE merchant_id = |", want: "now(),uuid()"},
	{in: merch + "WHERE txn_day = '2024-01-01' |", want: "AND,GROUP BY,ORDER BY"},
	{in: merch + "WHERE token(|", want: "=merchant_id,txn_day,txn_time,merchant_name,amount,currency,status"},
	{in: merch + "WHERE merchant_id IN (|", want: "now()"},
	{in: merch + "WHERE merchant_id = 1 AND tx|", want: "=txn_day,txn_time"},
	{in: merch + "WHERE merchant_id IS |", want: "=NOT NULL"},
	{in: merch + "WHERE currency CONTAINS |", want: "now()"},
	{in: "select * from payments.transactions_by_merchant where |", want: "merchant_id,txn_day,txn_time"},
	{in: "SELECT *\nFROM payments.merchants\nWHERE |", want: "merchant_id,name"},
	{in: "SELECT * FROM transactions_by_status WHERE |", want: "status,merchant_id,txn_day,amount"},
	{in: "SELECT * FROM unknown WHERE |", want: "=token()"},
	{in: "SELECT * FROM merchants WHERE |", ks: "shop", want: "=token()"},
	{in: "SELECT * FROM payments.merchants WHERE |", ks: "shop", want: "merchant_id,name"},
	{in: `SELECT * FROM "Orders" WHERE |`, ks: "shop", want: "OrderID,total,token()"},
	{in: `SELECT * FROM shop."Orders" WHERE O|`, want: "=OrderID"},

	// ORDER BY, GROUP BY, LIMIT.
	{in: merch + "WHERE status = 'x' ORDER |", want: "=BY"},
	{in: merch + "ORDER BY |", want: "=txn_time"},
	{in: merch + "ORDER BY txn_time |", want: "ASC,DESC,LIMIT"},
	{in: merch + "GROUP BY |", want: "merchant_id,txn_day,txn_time"},
	{in: merch + "GROUP BY merchant_id, |", want: "merchant_id,txn_day,txn_time"},
	{in: merch + "LIMIT 10 |", want: "=ALLOW FILTERING"},
	{in: merch + "ALLOW |", want: "=FILTERING"},
	{in: merch + "PER |", want: "=PARTITION LIMIT"},
	{in: merch + "PER PARTITION |", want: "=LIMIT"},

	// INSERT.
	{in: "INSERT |", want: "=INTO"},
	{in: "INSERT INTO |", want: "payments,shop,system,transactions_by_merchant"},
	{in: "INSERT INTO payments.|", want: "=transactions_by_merchant,ledger_counters,merchants"},
	{in: "INSERT INTO merchants |", want: "=JSON"},
	{in: "INSERT INTO merchants (|", want: "merchant_id,name,billing"},
	{in: "INSERT INTO merchants (merchant_id, |", want: "merchant_id,name"},
	{in: "INSERT INTO merchants (merchant_id) |", want: "=VALUES"},
	{in: "INSERT INTO merchants (merchant_id) VALUES (|", want: "now(),uuid()"},
	{in: "INSERT INTO merchants (merchant_id) VALUES (uuid()) |", want: "=IF NOT EXISTS,USING TTL,USING TIMESTAMP"},
	{in: "INSERT INTO merchants (merchant_id) VALUES (uuid()) IF |", want: "=NOT EXISTS"},
	{in: "INSERT INTO merchants (merchant_id) VALUES (uuid()) IF NOT |", want: "=EXISTS"},
	{in: "INSERT INTO merchants (merchant_id) VALUES (uuid()) US|", want: "=USING TTL,USING TIMESTAMP"},
	{in: "INSERT INTO merchants (merchant_id) VALUES (uuid()) USING |", want: "=TTL,TIMESTAMP"},
	{in: "INSERT INTO merchants (merchant_id) VALUES (uuid()) USING TTL 5 |", want: "=AND,IF NOT EXISTS"},
	{in: "INSERT INTO merchants (merchant_id) VALUES (uuid()) USING TTL 5 AND |", want: "=TTL,TIMESTAMP"},

	// UPDATE.
	{in: "UPDATE |", want: "payments,shop,system,transactions_by_merchant"},
	{in: "UPDATE merchants |", want: "=USING TTL,USING TIMESTAMP,SET"},
	{in: "UPDATE merchants USING TTL 5 |", want: "=AND,SET"},
	{in: "UPDATE merchants SET |", want: "=name,billing"},
	{in: "UPDATE merchants SET name = |", want: "now(),uuid()"},
	{in: "UPDATE merchants SET name = 'x' |", want: "=WHERE"},
	{in: "UPDATE merchants SET name = 'x', |", want: "=name,billing"},
	{in: "UPDATE merchants SET name = 'x' WHERE |", want: "merchant_id,name"},
	{in: "UPDATE merchants SET name = 'x' WHERE merchant_id = 1 |", want: "AND,IF,IF EXISTS"},
	{in: "UPDATE merchants SET name = 'x' WHERE merchant_id = 1 IF ex|", want: "=EXISTS"},
	{in: "UPDATE ledger_counters SET debits = debits + 1 WHERE |", want: "account_id,day"},

	// DELETE.
	{in: "DELETE | FROM merchants", want: "merchant_id,name,billing,FROM"},
	{in: "DELETE name |", want: "=FROM"},
	{in: "DELETE FROM |", want: "payments,shop,system,transactions_by_merchant"},
	{in: "DELETE FROM merchants |", want: "=USING TIMESTAMP,WHERE"},
	{in: "DELETE FROM merchants USING |", want: "=TIMESTAMP"},
	{in: "DELETE FROM merchants WHERE |", want: "merchant_id,name"},
	{in: "DELETE FROM merchants WHERE merchant_id = 1 |", want: "AND,IF"},

	// BATCH.
	{in: "BEGIN |", want: "=UNLOGGED,COUNTER,BATCH"},
	{in: "BEGIN UNLOGGED |", want: "=BATCH"},
	{in: "BEGIN BATCH |", want: "=USING TIMESTAMP,INSERT,UPDATE,DELETE,APPLY BATCH"},
	{in: "BEGIN BATCH USING TIMESTAMP 1 |", want: "=AND,INSERT,UPDATE,DELETE"},
	{in: "BEGIN BATCH INSERT INTO merchants (merchant_id) VALUES (uuid()); |", want: "=INSERT,UPDATE,DELETE,APPLY BATCH"},
	{in: "BEGIN BATCH INSERT INTO merchants (merchant_id) VALUES (uuid()); UPDATE merchants SET |", want: "=name,billing"},
	{in: "BEGIN BATCH INSERT INTO |", want: "payments,shop,system,transactions_by_merchant"},
	{in: "BEGIN BATCH INSERT INTO merchants (merchant_id) VALUES (uuid()); APPLY |", want: "=BATCH"},
	{in: "BEGIN BATCH UPDATE merchants SET name = 'x' WHERE |", want: "merchant_id,name"},

	// CREATE TABLE.
	{in: "CREATE |", want: "TABLE,KEYSPACE,TYPE,INDEX"},
	{in: "CREATE TABLE |", want: "payments,shop,system,IF NOT EXISTS"},
	{in: "CREATE TABLE IF |", want: "=NOT EXISTS"},
	{in: "CREATE TABLE payments.t (|", want: "=PRIMARY KEY"},
	{in: "CREATE TABLE t (id |", want: "ascii,bigint,blob"},
	{in: "CREATE TABLE t (id uuid, name |", want: "ascii,bigint,blob"},
	{in: "CREATE TABLE t (id uuid |", want: "=STATIC,PRIMARY KEY"},
	{in: "CREATE TABLE t (id list<|", want: "ascii,bigint"},
	{in: "CREATE TABLE t (id map<text, |", want: "ascii,bigint"},
	{in: "CREATE TABLE payments.t (id add|", want: "=address"},
	{in: "CREATE TABLE t (id uuid PRIMARY KEY, v text) |", want: "=WITH"},
	{in: "CREATE TABLE t (id uuid PRIMARY KEY, v text) WITH |", want: "CLUSTERING ORDER BY,COMPACT STORAGE,additional_write_policy"},
	{in: "CREATE TABLE t (id uuid PRIMARY KEY, v text) WITH comment = 'x' |", want: "=AND"},
	{in: "CREATE TABLE t (id uuid PRIMARY KEY, v text) WITH comment = 'x' AND |", want: "CLUSTERING ORDER BY"},
	{in: "CREATE TABLE t (a int, b int, PRIMARY |", want: "=KEY"},
	{in: "CREATE TABLE t (a int, b int, PRIMARY KEY (|", want: "=a,b"},
	{in: "CREATE TABLE t (a int, b int, PRIMARY KEY ((a), b)) WITH CLUSTERING ORDER BY (|", want: "=a,b"},
	{in: "CREATE TABLE t (a int, b int, PRIMARY KEY ((a), b)) WITH CLUSTERING ORDER BY (b |", want: "=ASC,DESC"},
	{in: "CREATE TABLE t (a int, b int, PRIMARY KEY ((a), b)) WITH default_time_to_live = 5 |", want: "=AND"},

	// CREATE TYPE, KEYSPACE, INDEX, VIEW.
	{in: "CREATE TYPE |", want: "payments,shop,system"},
	{in: "CREATE TYPE payments.t (a |", want: "ascii,bigint"},
	{in: "CREATE KEYSPACE |", want: "=IF NOT EXISTS"},
	{in: "CREATE KEYSPACE ks |", want: "=WITH"},
	{in: "CREATE KEYSPACE ks WITH |", want: "=replication,durable_writes"},
	{in: "CREATE KEYSPACE ks WITH replication = {'class': |", want: "='SimpleStrategy','NetworkTopologyStrategy'"},
	{in: "CREATE KEYSPACE ks WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1} |", want: "=AND"},
	{in: "CREATE KEYSPACE ks WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1} AND |", want: "=replication,durable_writes"},
	{in: "CREATE INDEX |", want: "=ON,IF NOT EXISTS"},
	{in: "CREATE INDEX ON |", want: "payments,shop,system,transactions_by_merchant"},
	{in: "CREATE INDEX ON merchants (|", want: "merchant_id,name,billing"},
	{in: "CREATE INDEX ON merchants (name) |", want: "=USING,WITH OPTIONS"},
	{in: "CREATE MATERIALIZED VIEW v AS SELECT | FROM merchants", want: "merchant_id,name"},
	{in: "CREATE MATERIALIZED VIEW v AS SELECT * FROM merchants WHERE |", want: "merchant_id,name"},

	// ALTER.
	{in: "ALTER |", want: "TABLE,TYPE,KEYSPACE"},
	{in: "ALTER TABLE |", want: "payments,shop,system,transactions_by_merchant"},
	{in: "ALTER TABLE merchants |", want: "=ADD,DROP,RENAME,WITH"},
	{in: "ALTER TABLE merchants ADD |", want: "=IF NOT EXISTS"},
	{in: "ALTER TABLE merchants ADD x |", want: "ascii,bigint"},
	{in: "ALTER TABLE merchants ADD x int |", want: "=STATIC"},
	{in: "ALTER TABLE merchants ADD x int, y list<|", want: "ascii,bigint"},
	{in: "ALTER TABLE merchants DROP |", want: "name,billing,IF EXISTS"},
	{in: "ALTER TABLE merchants RENAME |", want: "merchant_id,name"},
	{in: "ALTER TABLE merchants RENAME name |", want: "=TO"},
	{in: "ALTER TABLE merchants WITH |", want: "CLUSTERING ORDER BY"},
	{in: "ALTER TYPE address |", want: "=ADD,RENAME"},
	{in: "ALTER TYPE address ADD z |", want: "ascii,bigint"},
	{in: "ALTER KEYSPACE payments WITH |", want: "=replication,durable_writes"},

	// DROP and TRUNCATE.
	{in: "DROP |", want: "TABLE,KEYSPACE,TYPE"},
	{in: "DROP TABLE |", want: "payments,shop,system,transactions_by_merchant"},
	{in: "DROP TABLE IF |", want: "=EXISTS"},
	{in: "DROP TABLE IF EXISTS payments.|", want: "=transactions_by_merchant,ledger_counters,merchants"},
	{in: "DROP KEYSPACE |", want: "payments,shop,system"},
	{in: "DROP TYPE payments.|", want: "=address,geo_point,billing_profile"},
	{in: "DROP MATERIALIZED VIEW payments.|", want: "=transactions_by_status"},
	{in: "DROP INDEX payments.|", want: "=txn_by_currency"},
	{in: "TRUNCATE |", want: "payments"},
	{in: "TRUNCATE TABLE payments.|", want: "=transactions_by_merchant,ledger_counters,merchants"},
}

func labels(r Result) []string {
	out := make([]string, len(r.Items))
	for i, it := range r.Items {
		out[i] = it.Label
	}
	return out
}

func run(snap *schema.Snapshot, ks, in string) (Result, string) {
	cur := strings.Index(in, "|")
	text := in[:cur] + in[cur+1:]
	if ks == "" {
		ks = "payments"
	}
	if ks == "-" {
		ks = ""
	}
	return Complete(context.Background(), snap, ks, text, cur), text
}

func TestGolden(t *testing.T) {
	if len(goldenCases) < 80 {
		t.Fatalf("only %d golden cases; SPEC §10 requires 80", len(goldenCases))
	}
	snap := fixtureSnapshot()
	for _, c := range goldenCases {
		res, _ := run(snap, c.ks, c.in)
		got := labels(res)
		exact := strings.HasPrefix(c.want, "=")
		want := strings.TrimPrefix(c.want, "=")
		var wantL []string
		if want != "" {
			wantL = strings.Split(want, ",")
		}
		ok := len(got) >= len(wantL)
		if exact {
			ok = len(got) == len(wantL)
		}
		for i := 0; ok && i < len(wantL); i++ {
			ok = got[i] == wantL[i]
		}
		if !ok {
			t.Errorf("%q (ks=%q):\n  got  %q\n  want %q (exact=%v)", c.in, c.ks, got, wantL, exact)
		}
	}
}

func TestNilSnapshot(t *testing.T) {
	res, _ := run(nil, "", "SELECT * FROM |")
	if res.Items == nil || len(res.Items) != 0 {
		t.Errorf("want empty non-nil list, got %v", res.Items)
	}
	res, _ = run(nil, "", "sel|")
	if got := labels(res); len(got) != 1 || got[0] != "SELECT" {
		t.Errorf("keywords without a snapshot: %v", got)
	}
	res, _ = run(nil, "", "CREATE TABLE t (id |")
	if len(res.Items) == 0 || res.Items[0].Label != "ascii" {
		t.Errorf("types without a snapshot: %v", labels(res))
	}
}

func TestFromOffset(t *testing.T) {
	snap := fixtureSnapshot()
	cases := []struct {
		in   string
		from int
	}{
		{"SELECT * FROM payments.mer|", 23},
		{"SELECT * FROM |", 14},
		{`SELECT * FROM "sh|`, 14},
		{"sel|", 0},
		{".pro|", 0},
	}
	for _, c := range cases {
		res, _ := run(snap, "", c.in)
		if res.From != c.from {
			t.Errorf("%q: from=%d want %d", c.in, res.From, c.from)
		}
	}
}

func TestInsertQuoting(t *testing.T) {
	snap := fixtureSnapshot()
	res, _ := run(snap, "", "SELECT * FROM shop.|")
	var got []string
	for _, it := range res.Items {
		got = append(got, it.Insert)
	}
	if want := []string{`"Orders"`, "order_items"}; strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("inserts %q want %q", got, want)
	}
	res, _ = run(snap, "shop", `SELECT * FROM "Orders" WHERE O|`)
	if len(res.Items) != 1 || res.Items[0].Insert != `"OrderID"` {
		t.Errorf("column quoting: %+v", res.Items)
	}
}

func TestItemFields(t *testing.T) {
	snap := fixtureSnapshot()
	res, _ := run(snap, "", merch+"WHERE |")
	first := res.Items[0]
	if first.Kind != KindColumn || first.Detail != "uuid" || first.Key != schema.KindPartition || first.Position != 1 {
		t.Errorf("partition column: %+v", first)
	}
	if ck := res.Items[2]; ck.Key != schema.KindClustering || ck.Order != "DESC" {
		t.Errorf("clustering column: %+v", ck)
	}
	res, _ = run(snap, "", "SELECT * FROM payments.|")
	if d := res.Items[0].Detail; d != "PK (merchant_id, txn_day) · CK (txn_time)" {
		t.Errorf("table detail %q", d)
	}
	if res.Items[3].Kind != KindView {
		t.Errorf("view kind: %+v", res.Items[3])
	}
	res, _ = run(snap, "", "|")
	if res.Items[0].Kind != KindKeyword {
		t.Errorf("start kinds: %+v", res.Items)
	}
	res, _ = run(snap, "", ".|")
	if res.Items[0].Kind != KindCommand {
		t.Errorf("dot kinds: %+v", res.Items)
	}
}

func TestCursorBounds(t *testing.T) {
	snap := fixtureSnapshot()
	for _, cur := range []int{-5, 0, 3, 1000} {
		_ = Complete(context.Background(), snap, "", "SELECT é FROM", cur)
	}
	// A cursor inside a multi-byte character must not panic.
	_ = Complete(context.Background(), snap, "", "SELECT é FROM", 8)
}
