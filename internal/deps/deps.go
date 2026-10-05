// Package deps builds the dependency index over a schema snapshot (SPEC §9.14). Edges are
// computed from the snapshot only; nothing is inferred.
package deps

import (
	"sort"
	"strings"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/schema"
)

// Object kinds.
const (
	KindKeyspace  = "keyspace"
	KindTable     = "table"
	KindView      = "view"
	KindIndex     = "index"
	KindTrigger   = "trigger"
	KindType      = "type"
	KindFunction  = "function"
	KindAggregate = "aggregate"
)

// Ref identifies a schema object. Signature is set for functions and aggregates only.
type Ref struct {
	Kind      string `json:"kind"`
	Keyspace  string `json:"keyspace"`
	Name      string `json:"name"`
	Signature string `json:"signature,omitempty"`
}

func (r Ref) key() string {
	id := r.Name
	if r.Signature != "" {
		id = r.Signature
	}
	return r.Kind + "|" + r.Keyspace + "|" + id
}

// Item is one related object: the object itself, why it is related, and whether the edge stops
// Cassandra from dropping the target.
type Item struct {
	Ref
	Via      string `json:"via"`
	Blocking bool   `json:"blocking"`
}

type edge struct {
	from, to Ref
	via      string
	blocking bool
}

// Index answers dependents and dependencies for every object of a snapshot.
type Index struct {
	nodes map[string]Ref
	in    map[string][]edge // by target key
	out   map[string][]edge // by source key
	seen  map[string]bool
}

// Build indexes snap.
func Build(snap *schema.Snapshot) *Index {
	x := &Index{nodes: map[string]Ref{}, in: map[string][]edge{}, out: map[string][]edge{}, seen: map[string]bool{}}
	if snap == nil {
		return x
	}
	for i := range snap.Keyspaces {
		x.addKeyspace(&snap.Keyspaces[i])
	}
	for _, l := range x.in {
		sortEdges(l, true)
	}
	for _, l := range x.out {
		sortEdges(l, false)
	}
	return x
}

func sortEdges(l []edge, byFrom bool) {
	sort.Slice(l, func(i, j int) bool {
		a, b := l[i].to, l[j].to
		if byFrom {
			a, b = l[i].from, l[j].from
		}
		if a.key() != b.key() {
			return a.key() < b.key()
		}
		return l[i].via < l[j].via
	})
}

func (x *Index) node(r Ref) { x.nodes[r.key()] = r }

func (x *Index) link(from, to Ref, via string, blocking bool) {
	id := from.key() + ">" + to.key() + ">" + via
	if x.seen[id] {
		return
	}
	x.seen[id] = true
	e := edge{from, to, via, blocking}
	x.out[from.key()] = append(x.out[from.key()], e)
	x.in[to.key()] = append(x.in[to.key()], e)
}

func (x *Index) addKeyspace(ks *schema.Keyspace) {
	kref := Ref{Kind: KindKeyspace, Name: ks.Name}
	x.node(kref)
	udt := func(name string) Ref { return Ref{Kind: KindType, Keyspace: ks.Name, Name: name} }

	// udtRefs links `from` to every UDT mentioned in t.
	udtRefs := func(from Ref, t codec.TypeDesc, via string, blocking bool) {
		t.Walk(func(d codec.TypeDesc) {
			if d.UDT != nil {
				x.link(from, Ref{Kind: KindType, Keyspace: d.UDT.Keyspace, Name: d.UDT.Name}, via, blocking)
			}
		})
	}
	cqlRefs := func(from Ref, cql, via string) {
		if t, err := codec.Parse(cql, ks.Name); err == nil {
			udtRefs(from, t, via, true)
		}
	}

	for _, t := range ks.Tables {
		tref := Ref{Kind: KindTable, Keyspace: ks.Name, Name: t.Name}
		x.node(tref)
		x.link(tref, kref, "keyspace", false)
		for _, c := range t.Columns {
			udtRefs(tref, c.Type, "column "+c.Name, true)
		}
		for _, ix := range t.Indexes {
			iref := Ref{Kind: KindIndex, Keyspace: ks.Name, Name: ix.Name}
			x.node(iref)
			x.link(iref, tref, "column "+ix.Column, false)
		}
		for _, tr := range t.Triggers {
			rref := Ref{Kind: KindTrigger, Keyspace: ks.Name, Name: tr.Name}
			x.node(rref)
			x.link(rref, tref, "trigger on "+t.Name, false)
		}
	}
	for _, v := range ks.Views {
		vref := Ref{Kind: KindView, Keyspace: ks.Name, Name: v.Name}
		x.node(vref)
		x.link(vref, Ref{Kind: KindTable, Keyspace: ks.Name, Name: v.BaseTable}, "base table", true)
		x.link(vref, kref, "keyspace", false)
		for _, c := range v.Columns {
			udtRefs(vref, c.Type, "column "+c.Name, true)
		}
	}
	for _, u := range ks.Types {
		uref := udt(u.Name)
		x.node(uref)
		x.link(uref, kref, "keyspace", false)
		for _, f := range u.Fields {
			udtRefs(uref, f.Type, "field "+f.Name, true)
		}
	}
	for _, f := range ks.Functions {
		fref := Ref{Kind: KindFunction, Keyspace: ks.Name, Name: f.Name, Signature: f.Signature()}
		x.node(fref)
		x.link(fref, kref, "keyspace", false)
		for _, a := range f.ArgTypes {
			cqlRefs(fref, a, "argument type")
		}
		cqlRefs(fref, f.ReturnType, "return type")
	}
	for _, a := range ks.Aggregates {
		aref := Ref{Kind: KindAggregate, Keyspace: ks.Name, Name: a.Name, Signature: a.Signature()}
		x.node(aref)
		x.link(aref, kref, "keyspace", false)
		if f := findFunc(ks, a.StateFunc, len(a.ArgTypes)+1); f != nil {
			x.link(aref, Ref{Kind: KindFunction, Keyspace: ks.Name, Name: f.Name, Signature: f.Signature()}, "state function", true)
		}
		if f := findFunc(ks, a.FinalFunc, 1); f != nil {
			x.link(aref, Ref{Kind: KindFunction, Keyspace: ks.Name, Name: f.Name, Signature: f.Signature()}, "final function", true)
		}
		cqlRefs(aref, a.StateType, "state type")
		for _, t := range a.ArgTypes {
			cqlRefs(aref, t, "argument type")
		}
	}
}

// findFunc returns the function called name with the given arity, or nil.
func findFunc(ks *schema.Keyspace, name string, arity int) *schema.Function {
	if name == "" {
		return nil
	}
	for i := range ks.Functions {
		if f := &ks.Functions[i]; strings.EqualFold(f.Name, name) && len(f.ArgTypes) == arity {
			return f
		}
	}
	return nil
}

// Exists reports whether ref is an object of the snapshot.
func (x *Index) Exists(r Ref) bool { _, ok := x.nodes[r.key()]; return ok }

// Dependents lists the objects that depend on ref.
func (x *Index) Dependents(r Ref) []Item {
	out := []Item{}
	for _, e := range x.in[r.key()] {
		out = append(out, Item{Ref: e.from, Via: e.via, Blocking: e.blocking})
	}
	return out
}

// Dependencies lists the objects ref depends on.
func (x *Index) Dependencies(r Ref) []Item {
	out := []Item{}
	for _, e := range x.out[r.key()] {
		out = append(out, Item{Ref: e.to, Via: e.via, Blocking: e.blocking})
	}
	return out
}
