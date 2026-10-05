package advise

import (
	"reflect"
	"testing"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/schema"
)

func ty(n string) codec.TypeDesc { return codec.TypeDesc{Name: n} }

func col(name, typ, kind string) schema.Column {
	return schema.Column{Name: name, Type: ty(typ), Kind: kind}
}

func TestExplainTable(t *testing.T) {
	req := schema.TableRequest{
		Keyspace: "shop", Name: "events",
		Columns:      []schema.TableColumn{{Name: "id", Type: ty("uuid")}, {Name: "ts", Type: ty("timestamp")}},
		PartitionKey: []string{"id"},
		Clustering:   []schema.TableClustering{{Column: "ts", Order: "DESC"}},
	}
	want := []string{
		"Creates table events in keyspace shop.",
		"Rows are spread across the cluster by id: each id value lives on its own set of replicas.",
		"Inside each partition, rows are sorted by ts, newest first.",
		"Queries must include id; they can also filter or range over ts.",
	}
	if got := ExplainTable(nil, req); !reflect.DeepEqual(got, want) {
		t.Errorf("create:\n%q", got)
	}
	got := ExplainTable(nil, schema.TableRequest{Name: "users", Action: schema.TableDrop})
	if got[0] != "Deletes table users and all of its data. This cannot be undone." {
		t.Errorf("drop: %q", got)
	}
}

func TestExplainKeyspaceAndIndex(t *testing.T) {
	got := ExplainKeyspace(schema.KeyspaceRequest{Name: "shop", Strategy: schema.StrategyNTS, DurableWrites: true, Datacenters: []schema.DCRequest{{Name: "dc1", RF: 3}}})
	want := []string{"Creates keyspace shop.", "Keeps 3 copies of every row in datacenter dc1."}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("keyspace: %q", got)
	}
	s := &schema.Snapshot{Keyspaces: []schema.Keyspace{{Name: "shop", Tables: []schema.Table{{Name: "users", Columns: []schema.Column{col("id", "uuid", schema.KindPartition)}}}}}}
	got = ExplainIndex(s, schema.IndexRequest{Action: schema.IndexCreate, Keyspace: "shop", Table: "users", Column: "email"})
	if got[0] != "Lets you query users by email without including id; each such query asks every node." {
		t.Errorf("index: %q", got)
	}
	for _, l := range [][]string{ExplainRole(schema.RoleRequest{Action: schema.RoleCreate, Role: "a", Password: "secret123"}), ExplainTable(nil, schema.TableRequest{Action: "bogus"})} {
		if len(l) == 0 || l[0] == "" {
			t.Error("empty explain")
		}
		for _, x := range l {
			if x == "secret123" {
				t.Error("password leaked")
			}
		}
	}
}

func ids(fs []Finding) []string {
	out := []string{}
	for _, f := range fs {
		out = append(out, f.ID)
	}
	return out
}

func tbl(cols ...schema.Column) schema.Table {
	return schema.Table{Keyspace: "k", Name: "t", Columns: cols}
}

func TestAdviseTableRules(t *testing.T) {
	readings := tbl(col("sensor", "uuid", schema.KindPartition), col("ts", "timestamp", schema.KindClustering), col("v", "double", schema.KindRegular))
	if got := ids(AdviseTable(readings, ClusterFacts{})); !reflect.DeepEqual(got, []string{"A002"}) {
		t.Errorf("A002: %v", got)
	}
	bucketed := tbl(col("sensor", "uuid", schema.KindPartition), col("day", "date", schema.KindPartition), col("ts", "timestamp", schema.KindClustering))
	if got := ids(AdviseTable(bucketed, ClusterFacts{})); len(got) != 0 {
		t.Errorf("bucketed: %v", got)
	}
	for _, typ := range []string{"boolean", "tinyint", "date"} {
		if got := ids(AdviseTable(tbl(col("a", typ, schema.KindPartition)), ClusterFacts{})); !reflect.DeepEqual(got, []string{"A001"}) {
			t.Errorf("A001 %s: %v", typ, got)
		}
	}
	if got := ids(AdviseTable(tbl(col("a", "uuid", schema.KindPartition)), ClusterFacts{})); len(got) != 0 {
		t.Errorf("clean: %v", got)
	}

	idx := tbl(col("id", "uuid", schema.KindPartition), col("email", "text", schema.KindRegular), col("a", "int", schema.KindRegular))
	idx.Indexes = []schema.Index{{Column: "email"}, {Column: "a"}, {Column: "a"}, {Column: "a"}}
	if got := ids(AdviseTable(idx, ClusterFacts{})); !reflect.DeepEqual(got, []string{"A003", "A004"}) {
		t.Errorf("A003/4: %v", got)
	}
	idx.Indexes = []schema.Index{{Column: "email", SAI: true}}
	if got := ids(AdviseTable(idx, ClusterFacts{})); len(got) != 0 {
		t.Errorf("SAI: %v", got)
	}

	cols := []schema.Column{col("id", "uuid", schema.KindPartition)}
	for i := 0; i < 6; i++ {
		c := col(string(rune('a'+i)), "set", schema.KindRegular)
		cols = append(cols, c)
	}
	if got := ids(AdviseTable(tbl(cols...), ClusterFacts{})); !reflect.DeepEqual(got, []string{"A005"}) {
		t.Errorf("A005: %v", got)
	}
	if got := ids(AdviseTable(tbl(col("id", "uuid", schema.KindPartition), col("l", "list", schema.KindRegular)), ClusterFacts{})); !reflect.DeepEqual(got, []string{"A006"}) {
		t.Errorf("A006: %v", got)
	}
	cc := []schema.Column{col("id", "uuid", schema.KindPartition)}
	for i := 0; i < 11; i++ {
		cc = append(cc, col(string(rune('a'+i)), "counter", schema.KindRegular))
	}
	if got := ids(AdviseTable(tbl(cc...), ClusterFacts{})); !reflect.DeepEqual(got, []string{"A007"}) {
		t.Errorf("A007: %v", got)
	}
	tw := tbl(col("id", "uuid", schema.KindPartition))
	tw.Options = []schema.Option{{Name: "compaction", Value: "{'class': 'TimeWindowCompactionStrategy'}"}, {Name: "default_time_to_live", Value: "0"}}
	if got := ids(AdviseTable(tw, ClusterFacts{})); !reflect.DeepEqual(got, []string{"A010"}) {
		t.Errorf("A010: %v", got)
	}
	tw.Options[1].Value = "86400"
	if got := ids(AdviseTable(tw, ClusterFacts{})); len(got) != 0 {
		t.Errorf("A010 ttl: %v", got)
	}
}

func TestAdviseKeyspaceRules(t *testing.T) {
	simple := schema.Keyspace{Name: "k", Replication: map[string]string{"class": "org.apache.cassandra.locator.SimpleStrategy", "replication_factor": "1"}}
	if got := ids(AdviseKeyspace(simple, ClusterFacts{Nodes: 3, DCs: 2})); !reflect.DeepEqual(got, []string{"A008", "A009"}) {
		t.Errorf("simple: %v", got)
	}
	if got := ids(AdviseKeyspace(simple, ClusterFacts{Nodes: 1, DCs: 1})); len(got) != 0 {
		t.Errorf("single node: %v", got)
	}
	simple.System = true
	if got := AdviseKeyspace(simple, ClusterFacts{Nodes: 3, DCs: 2}); len(got) != 0 {
		t.Errorf("system: %v", got)
	}
}

func TestDraftTable(t *testing.T) {
	req := schema.TableRequest{Keyspace: "k", Name: "readings",
		Columns:      []schema.TableColumn{{Name: "sensor", Type: ty("uuid")}, {Name: "ts", Type: ty("timestamp")}},
		PartitionKey: []string{"sensor"}, Clustering: []schema.TableClustering{{Column: "ts"}}}
	if got := ids(AdviseTable(DraftTable(req), ClusterFacts{})); !reflect.DeepEqual(got, []string{"A002"}) {
		t.Errorf("%v", got)
	}
}
