package schema

import (
	"strings"
	"testing"
)

func alterSnapshot(version string) *Snapshot {
	sc := func(n, k string) Column {
		c := Column{Name: n, Type: nat("text"), Kind: k}
		return c
	}
	users := Table{Keyspace: "shop", Name: "users",
		Columns: []Column{{Name: "id", Type: nat("uuid"), Kind: KindPartition}, sc("ts", KindClustering), sc("name", KindRegular), sc("email", KindRegular)},
		Options: []Option{{Name: "default_time_to_live", Value: "0"}, {Name: "gc_grace_seconds", Value: "864000"}, {Name: "comment", Value: "''"}},
		Indexes: []Index{{Name: "users_email_idx", Column: "email"}}, Triggers: []Trigger{{Name: "trg"}},
		DroppedColumns: []DroppedColumn{{Name: "old", Type: "int"}}}
	flat := Table{Keyspace: "shop", Name: "flat", Columns: []Column{{Name: "id", Type: nat("uuid"), Kind: KindPartition}}}
	counters := Table{Keyspace: "shop", Name: "hits", Counter: true, Columns: []Column{{Name: "id", Type: nat("uuid"), Kind: KindPartition}, {Name: "n", Type: nat("counter"), Kind: KindRegular}}}
	withView := Table{Keyspace: "shop", Name: "base", Views: []string{"v1", "v2"},
		Columns: []Column{{Name: "id", Type: nat("uuid"), Kind: KindPartition}, sc("x", KindRegular)}}
	return &Snapshot{Version: version, Keyspaces: []Keyspace{
		{Name: "shop", Tables: []Table{users, flat, counters, withView}, Views: []View{{Name: "v1", BaseTable: "base"}}},
		{Name: "system_x", System: true, Tables: []Table{{Name: "t"}}},
	}}
}

func TestPlanTableAlter(t *testing.T) {
	ttl, grace, neg, big := 86400, 100, -1, 999999999999
	str := func(s string) *string { return &s }
	phone := tcol("phone", "text")
	tests := []struct {
		name    string
		version string
		req     TableRequest
		want    string
		err     string // "field=message" substring, "=Nothing to change" for a field-less error
		notes   []string
	}{
		{name: "add column", req: TableRequest{Action: "add_column", Name: "users", Column: phone}, want: "ALTER TABLE shop.users ADD phone text;"},
		{name: "add static", req: TableRequest{Action: "add_column", Name: "users", Column: TableColumn{Name: "s", Type: nat("int"), Static: true}}, want: "ALTER TABLE shop.users ADD s int STATIC;"},
		{name: "static needs clustering", req: TableRequest{Action: "add_column", Name: "flat", Column: TableColumn{Name: "s", Type: nat("int"), Static: true}}, err: "column.static="},
		{name: "counter in normal table", req: TableRequest{Action: "add_column", Name: "users", Column: tcol("c", "counter")}, err: "column.type=Counter columns"},
		{name: "non-counter in counter table", req: TableRequest{Action: "add_column", Name: "hits", Column: phone}, err: "column.type=A counter table"},
		{name: "counter in counter table", req: TableRequest{Action: "add_column", Name: "hits", Column: tcol("m", "counter")}, want: "ALTER TABLE shop.hits ADD m counter;"},
		{name: "duplicate", req: TableRequest{Action: "add_column", Name: "users", Column: tcol("NAME", "text")}, err: "column.name=Duplicate"},
		{name: "bad name", req: TableRequest{Action: "add_column", Name: "users", Column: tcol("1x", "text")}, err: "column.name=Use letters"},
		{name: "dropped other type", req: TableRequest{Action: "add_column", Name: "users", Column: tcol("old", "text")}, err: "was dropped with type int; re-add it with that type or choose another name"},
		{name: "dropped same type", req: TableRequest{Action: "add_column", Name: "users", Column: tcol("old", "int")}, want: "ADD old int;"},
		{name: "drop column", req: TableRequest{Action: "drop_column", Name: "users", Column: TableColumn{Name: "name"}}, want: "ALTER TABLE shop.users DROP name;", notes: []string{"cannot be recovered"}},
		{name: "drop key", req: TableRequest{Action: "drop_column", Name: "users", Column: TableColumn{Name: "id"}}, err: "column.name=Primary key"},
		{name: "drop unknown", req: TableRequest{Action: "drop_column", Name: "users", Column: TableColumn{Name: "zz"}}, err: "not found"},
		{name: "drop with views", req: TableRequest{Action: "drop_column", Name: "base", Column: TableColumn{Name: "x"}}, err: "Drop the views first: v1, v2"},
		{name: "drop indexed", req: TableRequest{Action: "drop_column", Name: "users", Column: TableColumn{Name: "email"}}, err: "Drop index users_email_idx first"},
		{name: "rename key", req: TableRequest{Action: "rename_column", Name: "users", From: "ts", To: "at"}, want: "ALTER TABLE shop.users RENAME ts TO at;"},
		{name: "rename regular", req: TableRequest{Action: "rename_column", Name: "users", From: "name", To: "n"}, err: "Cassandra can only rename primary key columns"},
		{name: "rename with views", req: TableRequest{Action: "rename_column", Name: "base", From: "id", To: "k"}, err: "Drop the views first"},
		{name: "rename taken", req: TableRequest{Action: "rename_column", Name: "users", From: "ts", To: "name"}, err: "to=Duplicate"},
		{name: "rename bad", req: TableRequest{Action: "rename_column", Name: "users", From: "ts", To: "a-b"}, err: "to=Use letters"},
		{name: "ttl only", req: TableRequest{Action: "options", Name: "users", Alter: &AlterOptions{DefaultTTLSeconds: &ttl, GCGraceSeconds: ptr(864000)}}, want: "ALTER TABLE shop.users WITH default_time_to_live = 86400;"},
		{name: "several", req: TableRequest{Action: "options", Name: "users", Alter: &AlterOptions{GCGraceSeconds: &grace, Comment: str("it's")}}, want: "WITH comment = 'it''s' AND gc_grace_seconds = 100;"},
		{name: "caching", req: TableRequest{Action: "options", Name: "users", Alter: &AlterOptions{Caching: &TableCaching{Keys: "all", RowsPerPartition: "100"}}}, want: "caching = {'keys': 'ALL', 'rows_per_partition': '100'}"},
		{name: "caching bad", req: TableRequest{Action: "options", Name: "users", Alter: &AlterOptions{Caching: &TableCaching{Keys: "x", RowsPerPartition: "y"}}}, err: "caching.keys="},
		{name: "speculative", req: TableRequest{Action: "options", Name: "users", Alter: &AlterOptions{SpeculativeRetry: str("99p")}}, want: "speculative_retry = '99p'"},
		{name: "speculative bad", req: TableRequest{Action: "options", Name: "users", Alter: &AlterOptions{SpeculativeRetry: str("fast")}}, err: "speculative_retry="},
		{name: "read repair", version: "4.1.0", req: TableRequest{Action: "options", Name: "users", Alter: &AlterOptions{ReadRepair: str("none")}}, want: "read_repair = 'NONE'"},
		{name: "read repair old", version: "3.11.0", req: TableRequest{Action: "options", Name: "users", Alter: &AlterOptions{ReadRepair: str("NONE")}}, err: "read_repair=read_repair needs"},
		{name: "compaction twcs", req: TableRequest{Action: "options", Name: "users", Alter: &AlterOptions{Compaction: &TableCompaction{Class: CompactionTWCS}}}, want: "compaction = {'class': 'TimeWindowCompactionStrategy'}", notes: []string{"default TTL"}},
		{name: "ucs old", version: "4.1.0", req: TableRequest{Action: "options", Name: "users", Alter: &AlterOptions{Compaction: &TableCompaction{Class: CompactionUCS}}}, err: "compaction=UnifiedCompactionStrategy needs"},
		{name: "compression none", req: TableRequest{Action: "options", Name: "users", Alter: &AlterOptions{Compression: &TableCompression{Class: CompressionNone}}}, want: "compression = {'enabled': false}"},
		{name: "bad ttl", req: TableRequest{Action: "options", Name: "users", Alter: &AlterOptions{DefaultTTLSeconds: &big}}, err: "default_ttl_seconds="},
		{name: "bad gc", req: TableRequest{Action: "options", Name: "users", Alter: &AlterOptions{GCGraceSeconds: &neg}}, err: "gc_grace_seconds="},
		{name: "counter ttl", req: TableRequest{Action: "options", Name: "hits", Alter: &AlterOptions{DefaultTTLSeconds: &ttl}}, err: "default_ttl_seconds=A counter table"},
		{name: "nothing", req: TableRequest{Action: "options", Name: "users", Alter: &AlterOptions{GCGraceSeconds: ptr(864000)}}, err: "=Nothing to change"},
		{name: "nothing nil", req: TableRequest{Action: "options", Name: "users"}, err: "=Nothing to change"},
		{name: "truncate", req: TableRequest{Action: "truncate", Name: "users"}, want: "TRUNCATE shop.users;", notes: []string{"every node to be up", "snapshot"}},
		{name: "drop", req: TableRequest{Action: "drop", Name: "users"}, want: "DROP TABLE shop.users;", notes: []string{"index users_email_idx", "trigger trg"}},
		{name: "drop blocked", req: TableRequest{Action: "drop", Name: "base"}, err: "name=Drop the views first: v1, v2"},
		{name: "unknown table", req: TableRequest{Action: "drop", Name: "nope"}, err: "name=Table nope not found"},
		{name: "drop view", req: TableRequest{Action: "drop_view", Name: "v1"}, want: "DROP MATERIALIZED VIEW shop.v1;"},
		{name: "drop view missing", req: TableRequest{Action: "drop_view", Name: "zz"}, err: "View zz not found"},
		{name: "system", req: TableRequest{Action: "truncate", Keyspace: "system_x", Name: "t"}, err: "System keyspaces cannot be changed"},
		{name: "unknown action", req: TableRequest{Action: "zap", Name: "users"}, err: "action=Unknown"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			v := tt.version
			if v == "" {
				v = "5.0.0"
			}
			tt.req.Keyspace = firstNonEmpty(tt.req.Keyspace, "shop")
			p := PlanTable(alterSnapshot(v), tt.req)
			if p.Errors == nil || p.Notes == nil {
				t.Fatal("errors and notes must be non-nil")
			}
			if tt.err != "" {
				if p.Statement != "" || len(p.Errors) == 0 {
					t.Fatalf("want error %q, got %+v", tt.err, p)
				}
				var got []string
				for _, e := range p.Errors {
					got = append(got, e.Field+"="+e.Message)
				}
				if joined := strings.Join(got, "|"); !strings.Contains(joined, tt.err) {
					t.Fatalf("errors %q lack %q", joined, tt.err)
				}
				return
			}
			if len(p.Errors) > 0 {
				t.Fatalf("unexpected errors %+v", p.Errors)
			}
			if !strings.Contains(p.Statement, tt.want) {
				t.Fatalf("statement %q lacks %q", p.Statement, tt.want)
			}
			for _, n := range tt.notes {
				if !strings.Contains(strings.Join(p.Notes, "|"), n) {
					t.Errorf("notes %q lack %q", p.Notes, n)
				}
			}
		})
	}
}

func ptr[T any](v T) *T { return &v }

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
