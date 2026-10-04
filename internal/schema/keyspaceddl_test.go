package schema

import (
	"strings"
	"testing"
)

func TestPlanKeyspace(t *testing.T) {
	snap := &Snapshot{Keyspaces: []Keyspace{{Name: "inventory"}}}
	simple := KeyspaceRequest{Name: "shop", Strategy: StrategySimple, ReplicationFactor: 1, DurableWrites: true}
	nts := KeyspaceRequest{Name: "shop", Strategy: StrategyNTS, DurableWrites: true,
		Datacenters: []DCRequest{{"dc1", 3}, {"dc2", 2}}}
	with := func(r KeyspaceRequest, f func(*KeyspaceRequest)) KeyspaceRequest { f(&r); return r }

	tests := []struct {
		name  string
		req   KeyspaceRequest
		nodes map[string]int
		want  string
		errs  []string // field=message substrings
		notes []string
	}{
		{name: "simple", req: simple,
			want: "CREATE KEYSPACE shop WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1} AND durable_writes = true;"},
		{name: "nts", req: nts,
			want: "CREATE KEYSPACE shop WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 3, 'dc2': 2} AND durable_writes = true;"},
		{name: "mixed case", req: with(simple, func(r *KeyspaceRequest) { r.Name = "Shop" }),
			want:  `CREATE KEYSPACE "Shop" WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1} AND durable_writes = true;`,
			notes: []string{"Case is preserved because the name contains capitals"}},
		{name: "if not exists", req: with(simple, func(r *KeyspaceRequest) { r.IfNotExists = true }),
			want: "CREATE KEYSPACE IF NOT EXISTS shop WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1} AND durable_writes = true;"},
		{name: "exists with if not exists", req: with(simple, func(r *KeyspaceRequest) { r.Name = "inventory"; r.IfNotExists = true }),
			want:  "CREATE KEYSPACE IF NOT EXISTS inventory WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1} AND durable_writes = true;",
			notes: []string{"A keyspace with this name exists; nothing will change"}},
		{name: "durable false", req: with(simple, func(r *KeyspaceRequest) { r.DurableWrites = false }),
			want:  "CREATE KEYSPACE shop WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1} AND durable_writes = false;",
			notes: []string{"Commit log is skipped"}},
		{name: "simple multi dc", req: simple, nodes: map[string]int{"a": 1, "b": 1},
			want:  "CREATE KEYSPACE shop WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1} AND durable_writes = true;",
			notes: []string{"use NetworkTopologyStrategy in production"}},
		{name: "rf above nodes", req: nts, nodes: map[string]int{"dc1": 1, "dc2": 2},
			want:  "CREATE KEYSPACE shop WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 3, 'dc2': 2} AND durable_writes = true;",
			notes: []string{"RF 3 is greater than the 1 nodes in dc1"}},
		{name: "empty name", req: with(simple, func(r *KeyspaceRequest) { r.Name = "" }), errs: []string{"name=Name is required"}},
		{name: "long name", req: with(simple, func(r *KeyspaceRequest) { r.Name = strings.Repeat("a", 49) }), errs: []string{"name=Name must be at most 48"}},
		{name: "digit start", req: with(simple, func(r *KeyspaceRequest) { r.Name = "1abc" }), errs: []string{"name=Use letters"}},
		{name: "dash", req: with(simple, func(r *KeyspaceRequest) { r.Name = "a-b" }), errs: []string{"name=Use letters"}},
		{name: "system", req: with(simple, func(r *KeyspaceRequest) { r.Name = "System_foo" }), errs: []string{"name=Names starting with system are reserved"}},
		{name: "exists", req: with(simple, func(r *KeyspaceRequest) { r.Name = "inventory" }), errs: []string{"name=A keyspace with this name already exists"}},
		{name: "rf zero", req: with(simple, func(r *KeyspaceRequest) { r.ReplicationFactor = 0 }), errs: []string{"replication_factor="}},
		{name: "rf 21", req: with(simple, func(r *KeyspaceRequest) { r.ReplicationFactor = 21 }), errs: []string{"replication_factor="}},
		{name: "no strategy", req: with(simple, func(r *KeyspaceRequest) { r.Strategy = "" }), errs: []string{"strategy="}},
		{name: "no dcs", req: with(nts, func(r *KeyspaceRequest) { r.Datacenters = nil }), errs: []string{"datacenters=Add at least one datacenter"}},
		{name: "dc problems", req: with(nts, func(r *KeyspaceRequest) {
			r.Datacenters = []DCRequest{{"", 1}, {"a'b", 1}, {"x", 0}, {"x", 21}}
		}), errs: []string{"datacenters.0.name=Datacenter name is required", "datacenters.1.name=Datacenter name cannot contain quotes",
			"datacenters.2.rf=", "datacenters.3.name=Datacenter names must be unique", "datacenters.3.rf="}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p := PlanKeyspace(snap, tc.req, tc.nodes)
			if p.Errors == nil || p.Notes == nil {
				t.Fatal("errors and notes must be non-nil")
			}
			var got []string
			for _, e := range p.Errors {
				got = append(got, e.Field+"="+e.Message)
			}
			joined := strings.Join(got, "; ")
			for _, w := range tc.errs {
				if !strings.Contains(joined, w) {
					t.Errorf("errors %q missing %q", joined, w)
				}
			}
			if len(tc.errs) == 0 && len(got) > 0 {
				t.Errorf("unexpected errors: %q", joined)
			}
			if len(tc.errs) > 0 && p.Statement != "" {
				t.Errorf("statement should be empty, got %q", p.Statement)
			}
			if p.Statement != tc.want {
				t.Errorf("statement\n got %q\nwant %q", p.Statement, tc.want)
			}
			for _, w := range tc.notes {
				if !strings.Contains(strings.Join(p.Notes, "; "), w) {
					t.Errorf("notes %q missing %q", p.Notes, w)
				}
			}
		})
	}
}
