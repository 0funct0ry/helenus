package schema

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

func ledgerRows() (kss, tabs, cols, types []row) {
	kss = []row{{"keyspace_name": "payments", "durable_writes": true, "replication": map[string]string{"class": "org.apache.cassandra.locator.SimpleStrategy", "replication_factor": "1"}}}
	tabs = []row{{
		"keyspace_name": "payments", "table_name": "ledger_counters", "flags": []string{"compound", "counter"},
		"additional_write_policy": "99p", "bloom_filter_fp_chance": 0.01, "caching": map[string]string{"keys": "ALL", "rows_per_partition": "NONE"},
		"cdc": false, "comment": "",
		"compaction":  map[string]string{"class": "org.apache.cassandra.db.compaction.SizeTieredCompactionStrategy", "max_threshold": "32", "min_threshold": "4"},
		"compression": map[string]string{"chunk_length_in_kb": "16", "class": "org.apache.cassandra.io.compress.LZ4Compressor"},
		"memtable":    "", "crc_check_chance": 1.0, "default_time_to_live": 0, "extensions": map[string][]byte{},
		"gc_grace_seconds": 864000, "max_index_interval": 2048, "memtable_flush_period_in_ms": 0, "min_index_interval": 128,
		"read_repair": "BLOCKING", "speculative_retry": "99p", "read_repair_chance": 0.0, "dclocal_read_repair_chance": 0.0,
	}}
	c := func(name, kind, typ, order string, pos int) row {
		return row{"keyspace_name": "payments", "table_name": "ledger_counters", "column_name": name, "kind": kind, "type": typ, "clustering_order": order, "position": pos}
	}
	// Deliberately out of order: system_schema returns columns sorted by name.
	cols = []row{c("account_id", "partition_key", "uuid", "none", 0), c("credits", "regular", "counter", "none", -1), c("day", "clustering", "date", "desc", 0), c("debits", "regular", "counter", "none", -1)}
	types = []row{
		{"keyspace_name": "payments", "type_name": "address", "field_names": []string{"city"}, "field_types": []string{"text"}},
		{"keyspace_name": "payments", "type_name": "profile", "field_names": []string{"home"}, "field_types": []string{"frozen<address>"}},
	}
	return
}

func TestTableDDLMatchesServerGolden(t *testing.T) {
	kss, tabs, cols, types := ledgerRows()
	snap := assemble(kss, tabs, cols, nil, nil, types, nil, nil)
	want, err := os.ReadFile("testdata/golden/4.1/describe_table_payments-ledger_counters.cql")
	if err != nil {
		t.Fatal(err)
	}
	got := TableDDL(snap.Keyspace("payments").Tables[0])
	if strings.TrimSpace(string(want)) != got {
		t.Errorf("generated DDL differs from server golden\n%s", lineDiff(strings.TrimSpace(string(want)), got))
	}
	if !snap.Keyspace("payments").Tables[0].Counter {
		t.Error("counter table not flagged")
	}
}

func TestKeyspaceDDLShortensStrategyClass(t *testing.T) {
	kss, _, _, _ := ledgerRows()
	snap := assemble(kss, nil, nil, nil, nil, nil, nil, nil)
	want := "CREATE KEYSPACE payments WITH replication = {'class': 'SimpleStrategy', 'replication_factor': '1'}  AND durable_writes = true;"
	if got := KeyspaceDDL(snap.Keyspaces[0]); got != want {
		t.Errorf("got %s", got)
	}
}

func TestUDTUsageAndOrdering(t *testing.T) {
	kss, tabs, cols, types := ledgerRows()
	cols = append(cols, row{"keyspace_name": "payments", "table_name": "ledger_counters", "column_name": "addr", "kind": "regular", "type": "frozen<address>", "clustering_order": "none", "position": -1})
	snap := assemble(kss, tabs, cols, nil, nil, types, nil, nil)
	k := snap.Keyspace("payments")
	if got := strings.Join(k.Type("address").UsedBy, ","); got != "ledger_counters.addr,profile.home" {
		t.Errorf("used_by = %s", got)
	}
	var names []string
	for _, c := range k.Tables[0].Columns {
		names = append(names, c.Name)
	}
	if got := strings.Join(names, ","); got != "account_id,day,addr,credits,debits" {
		t.Errorf("column order = %s", got)
	}
	ordered := typesInDependencyOrder(*k)
	if ordered[0].Name != "address" || ordered[1].Name != "profile" {
		t.Errorf("type order = %v", ordered)
	}
}

func TestViewsLinkedToBaseTable(t *testing.T) {
	kss, tabs, cols, _ := ledgerRows()
	views := []row{{"keyspace_name": "payments", "view_name": "by_day", "base_table_name": "ledger_counters", "where_clause": "day IS NOT NULL", "include_all_columns": true, "default_time_to_live": 0}}
	snap := assemble(kss, tabs, cols, views, nil, nil, nil, nil)
	k := snap.Keyspace("payments")
	if len(k.Tables[0].Views) != 1 || k.Tables[0].Views[0] != "by_day" {
		t.Errorf("views = %v", k.Tables[0].Views)
	}
}

func TestParseDescribe(t *testing.T) {
	cases := map[string]Target{
		"DESCRIBE CLUSTER;":                     {Kind: Cluster},
		"desc keyspaces":                        {Kind: Keyspaces},
		"DESCRIBE KEYSPACE":                     {Kind: KeyspaceT},
		"DESCRIBE KEYSPACE Payments":            {Kind: KeyspaceT, Name: "payments"},
		`DESCRIBE KEYSPACE "Payments"`:          {Kind: KeyspaceT, Name: "Payments"},
		"DESCRIBE TABLES":                       {Kind: Tables},
		"DESCRIBE TABLE payments.merchants":     {Kind: TableT, Keyspace: "payments", Name: "merchants"},
		"DESCRIBE TABLE merchants":              {Kind: TableT, Name: "merchants"},
		`DESCRIBE TABLE "My Ks"."My.Table"`:     {Kind: TableT, Keyspace: "My Ks", Name: "My.Table"},
		"DESCRIBE TYPES":                        {Kind: Types},
		"DESCRIBE TYPE payments.address":        {Kind: TypeT, Keyspace: "payments", Name: "address"},
		"DESCRIBE MATERIALIZED VIEW payments.v": {Kind: ViewT, Keyspace: "payments", Name: "v"},
		"DESCRIBE INDEX payments.i":             {Kind: IndexT, Keyspace: "payments", Name: "i"},
		"DESCRIBE FUNCTIONS":                    {Kind: Functions},
		"DESCRIBE FUNCTION payments.f":          {Kind: FunctionT, Keyspace: "payments", Name: "f"},
		"DESCRIBE AGGREGATES":                   {Kind: Aggregates},
		"DESCRIBE AGGREGATE payments.a":         {Kind: AggregateT, Keyspace: "payments", Name: "a"},
		"DESCRIBE SCHEMA":                       {Kind: SchemaT},
		"DESCRIBE FULL SCHEMA":                  {Kind: FullSchema},
		"DESCRIBE payments.merchants":           {Kind: Bare, Keyspace: "payments", Name: "merchants"},
	}
	for in, want := range cases {
		got, err := ParseDescribe(in)
		if err != nil || got != want {
			t.Errorf("ParseDescribe(%q) = %+v, %v; want %+v", in, got, err, want)
		}
	}
	for _, bad := range []string{"DESCRIBE", "DESCRIBE TABLE", "DESCRIBE TABLES x", "DESCRIBE MATERIALIZED x", "DESCRIBE FULL", "DESCRIBE a b", `DESCRIBE TABLE "x`} {
		if _, err := ParseDescribe(bad); err == nil {
			t.Errorf("ParseDescribe(%q) should fail", bad)
		}
	}
}

func TestStatementQualifiesWithCurrentKeyspace(t *testing.T) {
	tg := Target{Kind: TableT, Name: "merchants"}
	if got := tg.Statement("payments"); got != "DESCRIBE TABLE payments.merchants" {
		t.Error(got)
	}
	if got := (Target{Kind: ViewT, Keyspace: "a", Name: "B"}).Statement(""); got != `DESCRIBE MATERIALIZED VIEW a."B"` {
		t.Error(got)
	}
}

func TestGenerateErrors(t *testing.T) {
	kss, tabs, cols, _ := ledgerRows()
	snap := assemble(kss, tabs, cols, nil, nil, nil, nil, nil)
	snap.Version = "3.11.16"
	if _, err := Generate(snap, Target{Kind: TableT, Name: "x"}, ""); err != ErrNoKeyspace {
		t.Errorf("want ErrNoKeyspace, got %v", err)
	}
	if _, err := Generate(snap, Target{Kind: TableT, Keyspace: "payments", Name: "nope"}, ""); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Errorf("got %v", err)
	}
	out, err := Generate(snap, Target{Kind: Bare, Name: "ledger_counters"}, "payments")
	if err != nil || !strings.Contains(out, "CREATE TABLE payments.ledger_counters") {
		t.Errorf("bare lookup: %q %v", out, err)
	}
}

func TestIdentQuoting(t *testing.T) {
	for in, want := range map[string]string{"plain_1": "plain_1", "Mixed": `"Mixed"`, "select": `"select"`, "a b": `"a b"`, "1x": `"1x"`} {
		if got := Ident(in); got != want {
			t.Errorf("Ident(%q) = %s, want %s", in, got, want)
		}
	}
}

// lineDiff lists lines that differ between server output and generated output.
func lineDiff(want, got string) string {
	w, g := strings.Split(want, "\n"), strings.Split(got, "\n")
	var b strings.Builder
	for i := 0; i < len(w) || i < len(g); i++ {
		var a, c string
		if i < len(w) {
			a = w[i]
		}
		if i < len(g) {
			c = g[i]
		}
		if a != c {
			fmt.Fprintf(&b, "line %d\n  server:    %q\n  generated: %q\n", i+1, a, c)
		}
	}
	return b.String()
}
