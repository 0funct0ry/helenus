package schema

import (
	"strings"
	"testing"
)

func TestPlanKeyspaceAlterDrop(t *testing.T) {
	snap := &Snapshot{Keyspaces: []Keyspace{
		{Name: "shop", DurableWrites: true, Replication: map[string]string{"class": "org.apache.cassandra.locator.SimpleStrategy", "replication_factor": "1"}},
		{Name: "multi", DurableWrites: true, Replication: map[string]string{"class": "org.apache.cassandra.locator.NetworkTopologyStrategy", "dc1": "3", "dc2": "2"}},
		{Name: "system_x", System: true},
	}}
	simple := func(rf int, durable bool) KeyspaceRequest {
		return KeyspaceRequest{Action: "alter", Name: "shop", Strategy: StrategySimple, ReplicationFactor: rf, DurableWrites: durable}
	}
	nts := func(durable bool, dcs ...DCRequest) KeyspaceRequest {
		return KeyspaceRequest{Action: "alter", Name: "multi", Strategy: StrategyNTS, Datacenters: dcs, DurableWrites: durable}
	}
	nodes := map[string]int{"dc1": 3, "dc2": 3}
	tests := []struct {
		name  string
		req   KeyspaceRequest
		nodes map[string]int
		want  string
		err   string
		notes []string
	}{
		{"rf up", simple(3, true), nil, "ALTER KEYSPACE shop WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 3};", "",
			[]string{"Run `nodetool repair -full` on every node in the cluster so existing data reaches the new replicas"}},
		{"durable only", simple(1, false), nil, "ALTER KEYSPACE shop WITH durable_writes = false;", "", []string{"Commit log is skipped"}},
		{"both", simple(2, false), nil, "ALTER KEYSPACE shop WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 2} AND durable_writes = false;", "", nil},
		{"no change", simple(1, true), nil, "", "=Nothing to change", nil},
		{"rf down", nts(true, DCRequest{"dc1", 2}, DCRequest{"dc2", 2}), nodes,
			"ALTER KEYSPACE multi WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 2, 'dc2': 2};", "", []string{"Run `nodetool cleanup` on every node"}},
		{"mixed", nts(true, DCRequest{"dc1", 2}, DCRequest{"dc2", 3}), nodes,
			"ALTER KEYSPACE multi WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 2, 'dc2': 3};", "",
			[]string{"repair -full` on every node in dc2", "nodetool cleanup"}},
		{"dc removed", nts(true, DCRequest{"dc1", 3}), nodes,
			"ALTER KEYSPACE multi WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 3};", "", []string{"nodetool cleanup"}},
		{"simple to nts", KeyspaceRequest{Action: "alter", Name: "shop", Strategy: StrategyNTS, DurableWrites: true, Datacenters: []DCRequest{{"dc1", 1}}}, nodes,
			"ALTER KEYSPACE shop WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 1};", "",
			[]string{"Keep the datacenter name exactly as reported (`dc1`)"}},
		{"unknown dc", nts(true, DCRequest{"dc9", 1}), nodes, "", "datacenters.0.name=Unknown datacenter dc9", nil},
		{"system", KeyspaceRequest{Action: "alter", Name: "system_x"}, nil, "", "name=System keyspaces cannot be changed", nil},
		{"missing", KeyspaceRequest{Action: "alter", Name: "nope"}, nil, "", "name=Keyspace nope does not exist", nil},
		{"drop", KeyspaceRequest{Action: "drop", Name: "shop"}, nil, "DROP KEYSPACE shop;", "", nil},
		{"drop system", KeyspaceRequest{Action: "drop", Name: "system_x"}, nil, "", "name=System keyspaces cannot be changed", nil},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p := PlanKeyspace(snap, tc.req, tc.nodes)
			var got []string
			for _, e := range p.Errors {
				got = append(got, e.Field+"="+e.Message)
			}
			if j := strings.Join(got, "; "); (tc.err == "" && j != "") || !strings.Contains(j, tc.err) {
				t.Errorf("errors %q, want %q", j, tc.err)
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
