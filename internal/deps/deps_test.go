package deps

import (
	"fmt"
	"testing"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/schema"
)

func udtCol(name, ks, typ string) schema.Column {
	return schema.Column{Name: name, Type: codec.TypeDesc{Name: "udt", UDT: &codec.UDTRef{Keyspace: ks, Name: typ}}}
}

func synthetic() *schema.Snapshot {
	return &schema.Snapshot{Keyspaces: []schema.Keyspace{{
		Name: "ks",
		Tables: []schema.Table{{
			Keyspace: "ks", Name: "t",
			Columns:  []schema.Column{udtCol("addr", "ks", "address")},
			Indexes:  []schema.Index{{Name: "t_ix", Column: "addr"}},
			Triggers: []schema.Trigger{{Name: "trg"}},
		}},
		Views: []schema.View{{Keyspace: "ks", Name: "v", BaseTable: "t"}},
		Types: []schema.UDT{
			{Keyspace: "ks", Name: "address"},
			{Keyspace: "ks", Name: "profile", Fields: []schema.Field{{Name: "home", Type: codec.TypeDesc{Name: "udt", UDT: &codec.UDTRef{Keyspace: "ks", Name: "address"}}}}},
		},
		Functions: []schema.Function{
			{Keyspace: "ks", Name: "f", ArgTypes: []string{"int", "frozen<address>"}, ReturnType: "int"},
			{Keyspace: "ks", Name: "fin", ArgTypes: []string{"int"}, ReturnType: "int"},
		},
		Aggregates: []schema.Aggregate{{Keyspace: "ks", Name: "agg", ArgTypes: []string{"frozen<address>"}, StateFunc: "f", StateType: "int", FinalFunc: "fin", ReturnType: "int"}},
	}}}
}

func has(items []Item, kind, name, via string, blocking bool) bool {
	for _, i := range items {
		if i.Kind == kind && i.Name == name && i.Via == via && i.Blocking == blocking {
			return true
		}
	}
	return false
}

func TestEveryEdgeKind(t *testing.T) {
	x := Build(synthetic())
	tbl := Ref{Kind: KindTable, Keyspace: "ks", Name: "t"}
	d := x.Dependents(tbl)
	for _, w := range []struct {
		kind, name, via string
		blocking        bool
	}{{KindView, "v", "base table", true}, {KindIndex, "t_ix", "column addr", false}, {KindTrigger, "trg", "trigger on t", false}} {
		if !has(d, w.kind, w.name, w.via, w.blocking) {
			t.Errorf("table dependents missing %+v: %+v", w, d)
		}
	}
	if !has(x.Dependencies(tbl), KindKeyspace, "ks", "keyspace", false) || !has(x.Dependencies(tbl), KindType, "address", "column addr", true) {
		t.Errorf("table dependencies: %+v", x.Dependencies(tbl))
	}
	ud := x.Dependents(Ref{Kind: KindType, Keyspace: "ks", Name: "address"})
	for _, w := range [][3]string{{KindTable, "t", "column addr"}, {KindType, "profile", "field home"}, {KindFunction, "f", "argument type"}, {KindAggregate, "agg", "argument type"}, {KindAggregate, "agg", "state type"}} {
		if w[2] == "state type" {
			continue // state type is int
		}
		if !has(ud, w[0], w[1], w[2], true) {
			t.Errorf("udt dependents missing %v: %+v", w, ud)
		}
	}
	fd := x.Dependents(Ref{Kind: KindFunction, Keyspace: "ks", Name: "f", Signature: "f(int, frozen<address>)"})
	if !has(fd, KindAggregate, "agg", "state function", true) {
		t.Errorf("function dependents: %+v", fd)
	}
	if !has(x.Dependents(Ref{Kind: KindFunction, Keyspace: "ks", Name: "fin", Signature: "fin(int)"}), KindAggregate, "agg", "final function", true) {
		t.Error("final function edge missing")
	}
	if x.Exists(Ref{Kind: KindTable, Keyspace: "ks", Name: "nope"}) {
		t.Error("unknown object exists")
	}
}

func BenchmarkBuild2000Tables(b *testing.B) {
	s := &schema.Snapshot{Keyspaces: []schema.Keyspace{{Name: "ks", Types: []schema.UDT{{Keyspace: "ks", Name: "address"}}}}}
	for i := 0; i < 2000; i++ {
		s.Keyspaces[0].Tables = append(s.Keyspaces[0].Tables, schema.Table{Keyspace: "ks", Name: fmt.Sprintf("t%d", i),
			Columns: []schema.Column{udtCol("a", "ks", "address"), {Name: "id"}}})
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Build(s)
	}
}
