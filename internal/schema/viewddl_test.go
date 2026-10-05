package schema

import (
	"strings"
	"testing"
)

func viewSnapshot() *Snapshot {
	base := Table{Keyspace: "shop", Name: "orders", Columns: []Column{
		{Name: "merchant", Type: nat("text"), Kind: KindPartition},
		{Name: "id", Type: nat("uuid"), Kind: KindClustering, Order: "ASC"},
		{Name: "status", Type: nat("text"), Kind: KindRegular},
		{Name: "total", Type: nat("int"), Kind: KindRegular},
		{Name: "note", Type: nat("text"), Kind: KindStatic},
	}}
	ctr := Table{Keyspace: "shop", Name: "hits", Counter: true, Columns: []Column{
		{Name: "id", Type: nat("int"), Kind: KindPartition}, {Name: "n", Type: nat("counter"), Kind: KindRegular}}}
	v := View{Keyspace: "shop", Name: "by_status", BaseTable: "orders", Options: []Option{{Name: "gc_grace_seconds", Value: "864000"}}}
	return &Snapshot{Version: "4.1.5", Keyspaces: []Keyspace{
		{Name: "shop", Tables: []Table{base, ctr}, Views: []View{v}},
		{Name: "system_x", System: true},
	}}
}

func TestPlanView(t *testing.T) {
	seven := 3600
	tests := []struct {
		name  string
		req   ViewRequest
		want  string
		err   string
		notes []string
	}{
		{name: "base keys only", req: ViewRequest{Name: "v", BaseTable: "orders", Columns: []string{"status"}, PartitionKey: []string{"merchant"}, Clustering: []TableClustering{{Column: "id"}}},
			want:  "CREATE MATERIALIZED VIEW shop.v AS\n  SELECT merchant, id, status\n  FROM shop.orders\n  WHERE merchant IS NOT NULL AND id IS NOT NULL\n  PRIMARY KEY (merchant, id);",
			notes: []string{"experimental", "Key columns added"}},
		{name: "extra column", req: ViewRequest{Name: "v", BaseTable: "orders", Columns: []string{"*"}, PartitionKey: []string{"status"}, Clustering: []TableClustering{{Column: "merchant"}, {Column: "id", Order: "DESC"}}},
			err: "Static column note"},
		{name: "extra column ok", req: ViewRequest{Name: "v", BaseTable: "orders", Columns: []string{"status", "total"}, PartitionKey: []string{"status"}, Clustering: []TableClustering{{Column: "merchant"}, {Column: "id", Order: "DESC"}}},
			want: "PRIMARY KEY (status, merchant, id)\n  WITH CLUSTERING ORDER BY (merchant ASC, id DESC);"},
		{name: "two extras", req: ViewRequest{Name: "v", BaseTable: "orders", Columns: []string{"status"}, PartitionKey: []string{"status", "total"}, Clustering: []TableClustering{{Column: "merchant"}, {Column: "id"}}},
			err: "at most one non-key column"},
		{name: "missing base key", req: ViewRequest{Name: "v", BaseTable: "orders", Columns: []string{"status"}, PartitionKey: []string{"merchant"}}, err: "missing id"},
		{name: "static column", req: ViewRequest{Name: "v", BaseTable: "orders", Columns: []string{"note"}, PartitionKey: []string{"merchant"}, Clustering: []TableClustering{{Column: "id"}}}, err: "Static column note"},
		{name: "counter base", req: ViewRequest{Name: "v", BaseTable: "hits", Columns: []string{"*"}, PartitionKey: []string{"id"}}, err: "Counter tables"},
		{name: "base is view", req: ViewRequest{Name: "v", BaseTable: "by_status", Columns: []string{"*"}}, err: "is a view"},
		{name: "missing base", req: ViewRequest{Name: "v", BaseTable: "zzz"}, err: "not found"},
		{name: "name taken", req: ViewRequest{Name: "by_status", BaseTable: "orders", Columns: []string{"status"}, PartitionKey: []string{"merchant"}, Clustering: []TableClustering{{Column: "id"}}}, err: "already exists"},
		{name: "bad name", req: ViewRequest{Name: "1x", BaseTable: "orders"}, err: "letters"},
		{name: "where semicolon", req: ViewRequest{Name: "v", BaseTable: "orders", Columns: []string{"status"}, PartitionKey: []string{"merchant"}, Clustering: []TableClustering{{Column: "id"}}, ExtraWhere: "a = 1;"}, err: "';'"},
		{name: "where quote", req: ViewRequest{Name: "v", BaseTable: "orders", Columns: []string{"status"}, PartitionKey: []string{"merchant"}, Clustering: []TableClustering{{Column: "id"}}, ExtraWhere: "status = 'a"}, err: "unbalanced"},
		{name: "where ok + options", req: ViewRequest{Name: "v", BaseTable: "orders", Columns: []string{"status"}, PartitionKey: []string{"merchant"}, Clustering: []TableClustering{{Column: "id"}}, ExtraWhere: "total > 5", IfNotExists: true,
			Options: TableOptions{GCGraceSeconds: &seven}},
			want: "CREATE MATERIALIZED VIEW IF NOT EXISTS shop.v AS\n  SELECT merchant, id, status\n  FROM shop.orders\n  WHERE merchant IS NOT NULL AND id IS NOT NULL AND total > 5\n  PRIMARY KEY (merchant, id)\n  WITH gc_grace_seconds = 3600;"},
		{name: "bad option", req: ViewRequest{Name: "v", BaseTable: "orders", Columns: []string{"status"}, PartitionKey: []string{"merchant"}, Clustering: []TableClustering{{Column: "id"}}, Options: TableOptions{Comment: strings.Repeat("x", 2000)}}, err: "Comment must"},
		{name: "alter", req: ViewRequest{Action: "alter", Name: "by_status", Alter: &AlterOptions{GCGraceSeconds: &seven}}, want: "ALTER MATERIALIZED VIEW shop.by_status WITH gc_grace_seconds = 3600;"},
		{name: "alter nothing", req: ViewRequest{Action: "alter", Name: "by_status", Alter: &AlterOptions{}}, err: "Nothing to change"},
		{name: "drop", req: ViewRequest{Action: "drop", Name: "by_status"}, want: "DROP MATERIALIZED VIEW shop.by_status;"},
		{name: "drop missing", req: ViewRequest{Action: "drop", Name: "zzz"}, err: "not found"},
		{name: "system keyspace", req: ViewRequest{Keyspace: "system_x", Name: "v", BaseTable: "t"}, err: "system keyspace"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := tc.req
			if req.Keyspace == "" {
				req.Keyspace = "shop"
			}
			p := PlanView(viewSnapshot(), req)
			if tc.err != "" {
				var all []string
				for _, e := range p.Errors {
					all = append(all, e.Message)
				}
				if !strings.Contains(strings.Join(all, "|"), tc.err) || p.Statement != "" {
					t.Fatalf("want error %q, got %+v", tc.err, p)
				}
				return
			}
			if len(p.Errors) > 0 {
				t.Fatalf("unexpected errors %+v", p.Errors)
			}
			if !strings.Contains(p.Statement, tc.want) {
				t.Errorf("statement\n%s\nwant to contain\n%s", p.Statement, tc.want)
			}
			for _, n := range tc.notes {
				if !strings.Contains(strings.Join(p.Notes, "|"), n) {
					t.Errorf("missing note %q in %v", n, p.Notes)
				}
			}
		})
	}
}
