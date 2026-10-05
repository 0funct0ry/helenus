package schema

import (
	"strings"
	"testing"

	"github.com/0funct0ry/helenus/internal/codec"
)

func tableSnapshot(version string) *Snapshot {
	return &Snapshot{Version: version, Keyspaces: []Keyspace{
		{Name: "shop",
			Tables: []Table{{Name: "orders", Indexes: []Index{{Name: "orders_idx"}}}},
			Views:  []View{{Name: "by_day"}},
			Types:  []UDT{{Name: "address"}}},
		{Name: "system_x", System: true},
	}}
}

func tcol(name, typ string) TableColumn { return TableColumn{Name: name, Type: nat(typ)} }

func usersReq() TableRequest {
	return TableRequest{Keyspace: "shop", Name: "users",
		Columns:      []TableColumn{tcol("id", "uuid"), tcol("name", "text"), tcol("email", "text")},
		PartitionKey: []string{"id"}}
}

func TestPlanTable(t *testing.T) {
	ttl, grace, bloom := 3600, 100, 0.1
	addr := codec.TypeDesc{Name: "address", UDT: &codec.UDTRef{Keyspace: "shop", Name: "address"}}
	otherUDT := codec.TypeDesc{Name: "geo", UDT: &codec.UDTRef{Keyspace: "other", Name: "geo"}}
	with := func(f func(*TableRequest)) TableRequest { r := usersReq(); f(&r); return r }
	tests := []struct {
		name    string
		version string
		req     TableRequest
		want    string
		errs    []string // "step:field" substrings
		notes   []string
	}{
		{name: "single pk", req: usersReq(),
			want: "CREATE TABLE shop.users (\n  id uuid,\n  name text,\n  email text,\n  PRIMARY KEY (id)\n);"},
		{name: "composite and clustering desc", req: TableRequest{Keyspace: "shop", Name: "events",
			Columns:      []TableColumn{tcol("tenant", "text"), tcol("day", "date"), tcol("ts", "timeuuid"), tcol("payload", "text")},
			PartitionKey: []string{"tenant", "day"}, Clustering: []TableClustering{{"ts", "DESC"}}},
			want: "CREATE TABLE shop.events (\n  tenant text,\n  day date,\n  ts timeuuid,\n  payload text,\n  PRIMARY KEY ((tenant, day), ts)\n) WITH CLUSTERING ORDER BY (ts DESC);"},
		{name: "all asc has no order clause", req: with(func(r *TableRequest) { r.Clustering = []TableClustering{{"name", ""}} }),
			want: "CREATE TABLE shop.users (\n  id uuid,\n  name text,\n  email text,\n  PRIMARY KEY (id, name)\n);"},
		{name: "static", req: with(func(r *TableRequest) {
			r.Clustering = []TableClustering{{"name", "ASC"}}
			r.Columns[2].Static = true
		}), want: "CREATE TABLE shop.users (\n  id uuid,\n  name text,\n  email text STATIC,\n  PRIMARY KEY (id, name)\n);"},
		{name: "static without clustering", req: with(func(r *TableRequest) { r.Columns[2].Static = true }), errs: []string{"2:columns.2.static"}},
		{name: "if not exists", req: with(func(r *TableRequest) { r.IfNotExists = true; r.Name = "orders" }),
			want: "CREATE TABLE IF NOT EXISTS shop.orders (\n  id uuid,\n  name text,\n  email text,\n  PRIMARY KEY (id)\n);", notes: []string{"exists"}},
		{name: "quoted name", req: with(func(r *TableRequest) { r.Name = "Users" }),
			want: "CREATE TABLE shop.\"Users\" (", notes: []string{"capitals"}},
		{name: "counter table", req: TableRequest{Keyspace: "shop", Name: "hits",
			Columns: []TableColumn{tcol("id", "uuid"), tcol("n", "counter")}, PartitionKey: []string{"id"}},
			want: "CREATE TABLE shop.hits (\n  id uuid,\n  n counter,\n  PRIMARY KEY (id)\n);", notes: []string{"Counter"}},
		{name: "counter mixed", req: with(func(r *TableRequest) { r.Columns[1] = tcol("n", "counter") }), errs: []string{"1:columns"}},
		{name: "counter with ttl", req: TableRequest{Keyspace: "shop", Name: "hits",
			Columns: []TableColumn{tcol("id", "uuid"), tcol("n", "counter")}, PartitionKey: []string{"id"},
			Options: TableOptions{DefaultTTLSeconds: 5}}, errs: []string{"3:default_ttl_seconds"}},
		{name: "counter in key", req: with(func(r *TableRequest) { r.Columns[0] = tcol("id", "counter") }), errs: []string{"2:partition_key.0"}},
		{name: "duration in key", req: with(func(r *TableRequest) { r.Columns[0] = tcol("id", "duration") }), errs: []string{"2:partition_key.0"}},
		{name: "frozen keys", req: TableRequest{Keyspace: "shop", Name: "k",
			Columns: []TableColumn{{Name: "a", Type: coll("list", nat("int"))}, {Name: "b", Type: addr}}, PartitionKey: []string{"a", "b"}},
			want: "CREATE TABLE shop.k (\n  a frozen<list<int>>,\n  b frozen<address>,\n  PRIMARY KEY ((a, b))\n);", notes: []string{"frozen"}},
		{name: "udt other keyspace", req: with(func(r *TableRequest) { r.Columns[1].Type = otherUDT }), errs: []string{"1:columns.1.type"}},
		{name: "unknown udt", req: with(func(r *TableRequest) {
			r.Columns[1].Type = codec.TypeDesc{Name: "nope", UDT: &codec.UDTRef{Keyspace: "shop", Name: "nope"}}
		}), errs: []string{"1:columns.1.type"}},
		{name: "options", req: with(func(r *TableRequest) {
			r.Options = TableOptions{Comment: "it's", DefaultTTLSeconds: ttl, GCGraceSeconds: &grace, BloomFilterFPChance: &bloom,
				Compaction:  TableCompaction{Class: CompactionLCS},
				Compression: TableCompression{Class: CompressionNone}}
		}), want: "PRIMARY KEY (id)\n) WITH comment = 'it''s' AND default_time_to_live = 3600 AND gc_grace_seconds = 100 AND bloom_filter_fp_chance = 0.1 AND compaction = {'class': 'LeveledCompactionStrategy'} AND compression = {'enabled': false};"},
		{name: "default options emit nothing", req: with(func(r *TableRequest) {
			g, b := defaultGCGrace, defaultBloomFP
			r.Options = TableOptions{GCGraceSeconds: &g, BloomFilterFPChance: &b, Compaction: TableCompaction{Class: CompactionSTCS}, Compression: TableCompression{Class: CompressionLZ4}}
		}), want: "  PRIMARY KEY (id)\n);"},
		{name: "unified on 5.0", version: "5.0", req: with(func(r *TableRequest) { r.Options.Compaction.Class = CompactionUCS }),
			want: "compaction = {'class': 'UnifiedCompactionStrategy'};"},
		{name: "unified on 4.1", version: "4.1", req: with(func(r *TableRequest) { r.Options.Compaction.Class = CompactionUCS }), errs: []string{"3:compaction"}},
		{name: "zstd on 4.1", version: "4.1", req: with(func(r *TableRequest) { r.Options.Compression.Class = "ZstdCompressor" }),
			want: "compression = {'class': 'ZstdCompressor'};"},
		{name: "zstd on 3.11", version: "3.11", req: with(func(r *TableRequest) { r.Options.Compression.Class = "ZstdCompressor" }), errs: []string{"3:compression"}},
		{name: "twcs without ttl", req: with(func(r *TableRequest) { r.Options.Compaction.Class = CompactionTWCS }), notes: []string{"default TTL"}},
		{name: "boolean pk", req: TableRequest{Keyspace: "shop", Name: "b", Columns: []TableColumn{tcol("f", "boolean")}, PartitionKey: []string{"f"}},
			want: "CREATE TABLE shop.b (\n  f boolean,\n  PRIMARY KEY (f)\n);", notes: []string{"boolean"}},
		{name: "key only table", req: TableRequest{Keyspace: "shop", Name: "k", Columns: []TableColumn{tcol("a", "int")}, PartitionKey: []string{"a"}},
			want: "PRIMARY KEY (a)"},
		{name: "empty name", req: with(func(r *TableRequest) { r.Name = "" }), errs: []string{"1:name"}},
		{name: "bad name", req: with(func(r *TableRequest) { r.Name = "1x" }), errs: []string{"1:name"}},
		{name: "long name", req: with(func(r *TableRequest) { r.Name = strings.Repeat("a", 49) }), errs: []string{"1:name"}},
		{name: "duplicate table", req: with(func(r *TableRequest) { r.Name = "orders" }), errs: []string{"1:name"}},
		{name: "duplicate view", req: with(func(r *TableRequest) { r.Name = "by_day" }), errs: []string{"1:name"}},
		{name: "duplicate index", req: with(func(r *TableRequest) { r.Name = "orders_idx" }), errs: []string{"1:name"}},
		{name: "no columns", req: TableRequest{Keyspace: "shop", Name: "t"}, errs: []string{"1:columns", "2:partition_key"}},
		{name: "empty column name", req: with(func(r *TableRequest) { r.Columns[1].Name = "" }), errs: []string{"1:columns.1.name"}},
		{name: "duplicate column", req: with(func(r *TableRequest) { r.Columns[1].Name = "ID" }), errs: []string{"1:columns.1.name"}},
		{name: "no partition key", req: with(func(r *TableRequest) { r.PartitionKey = nil }), errs: []string{"2:partition_key"}},
		{name: "key repeated", req: with(func(r *TableRequest) { r.Clustering = []TableClustering{{"id", "ASC"}} }), errs: []string{"2:clustering.0"}},
		{name: "key missing", req: with(func(r *TableRequest) { r.PartitionKey = []string{"zzz"} }), errs: []string{"2:partition_key.0"}},
		{name: "static key", req: with(func(r *TableRequest) { r.Columns[0].Static = true; r.Clustering = []TableClustering{{"name", ""}} }), errs: []string{"2:partition_key.0"}},
		{name: "bad order", req: with(func(r *TableRequest) { r.Clustering = []TableClustering{{"name", "UP"}} }), errs: []string{"2:clustering.0.order"}},
		{name: "ttl range", req: with(func(r *TableRequest) { r.Options.DefaultTTLSeconds = maxDefaultTTL + 1 }), errs: []string{"3:default_ttl_seconds"}},
		{name: "gc negative", req: with(func(r *TableRequest) { n := -1; r.Options.GCGraceSeconds = &n }), errs: []string{"3:gc_grace_seconds"}},
		{name: "bloom range", req: with(func(r *TableRequest) { z := 0.0; r.Options.BloomFilterFPChance = &z }), errs: []string{"3:bloom_filter_fp_chance"}},
		{name: "comment long", req: with(func(r *TableRequest) { r.Options.Comment = strings.Repeat("x", 1025) }), errs: []string{"3:comment"}},
		{name: "unknown compaction", req: with(func(r *TableRequest) { r.Options.Compaction.Class = "X" }), errs: []string{"3:compaction"}},
		{name: "unknown compressor", req: with(func(r *TableRequest) { r.Options.Compression.Class = "X" }), errs: []string{"3:compression"}},
		{name: "missing keyspace", req: with(func(r *TableRequest) { r.Keyspace = "nope" }), errs: []string{"1:keyspace"}},
		{name: "system keyspace", req: with(func(r *TableRequest) { r.Keyspace = "system_x" }), errs: []string{"1:keyspace"}},
		{name: "unknown type", req: with(func(r *TableRequest) { r.Columns[1].Type = nat("blah") }), errs: []string{"1:columns.1.type"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			v := tc.version
			if v == "" {
				v = "5.0"
			}
			p := PlanTable(tableSnapshot(v), tc.req)
			if p.Errors == nil || p.Notes == nil {
				t.Fatal("errors and notes must be non-nil")
			}
			var got []string
			for _, e := range p.Errors {
				got = append(got, itoa(e.Step)+":"+e.Field+"="+e.Message)
			}
			joined := strings.Join(got, "\n")
			for _, e := range tc.errs {
				if !strings.Contains(joined, e) {
					t.Errorf("want error %q in %q", e, joined)
				}
			}
			if len(tc.errs) == 0 && len(p.Errors) > 0 {
				t.Fatalf("unexpected errors: %s", joined)
			}
			if len(tc.errs) > 0 {
				if p.Statement != "" {
					t.Errorf("statement with errors: %s", p.Statement)
				}
				return
			}
			if !strings.Contains(p.Statement, tc.want) {
				t.Errorf("statement:\n%s\nwant to contain:\n%s", p.Statement, tc.want)
			}
			if strings.HasPrefix(tc.want, "CREATE") && !strings.HasPrefix(p.Statement, tc.want[:strings.Index(tc.want, "(")]) {
				t.Errorf("header mismatch: %s", p.Statement)
			}
			notes := strings.Join(p.Notes, "\n")
			for _, n := range tc.notes {
				if !strings.Contains(notes, n) {
					t.Errorf("want note %q in %q", n, notes)
				}
			}
		})
	}
}

func itoa(n int) string { return string(rune('0' + n)) }

func TestPlanTableExactAcceptance(t *testing.T) {
	p := PlanTable(tableSnapshot("5.0"), usersReq())
	want := "CREATE TABLE shop.users (\n  id uuid,\n  name text,\n  email text,\n  PRIMARY KEY (id)\n);"
	if p.Statement != want {
		t.Errorf("got:\n%s", p.Statement)
	}
}
