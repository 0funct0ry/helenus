// Package schema reads a cluster's schema into a compact snapshot and renders
// DESCRIBE output, using the server's DESCRIBE on Cassandra 4.0+ and generated
// DDL otherwise (SPEC §8.3).
package schema

import (
	"context"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	gocql "github.com/apache/cassandra-gocql-driver/v2"

	"github.com/0funct0ry/helenus/internal/codec"
)

// Column kinds as they appear in the API.
const (
	KindPartition  = "partition"
	KindClustering = "clustering"
	KindStatic     = "static"
	KindRegular    = "regular"
)

// Column is one table or view column.
type Column struct {
	Name string         `json:"name"`
	Type codec.TypeDesc `json:"type"`
	// CQL is Type rendered as CQL, for badges and DDL.
	CQL  string `json:"cql"`
	Kind string `json:"kind"`
	// Position is the 1-based place in the partition or clustering key; 0 otherwise.
	Position int `json:"position,omitempty"`
	// Order is ASC or DESC for clustering columns.
	Order string `json:"order,omitempty"`
}

// Option is one table option with its value already rendered as a CQL literal.
type Option struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// Index is a secondary index, including SAI and other custom indexes.
type Index struct {
	Name    string            `json:"name"`
	Kind    string            `json:"kind"`
	Target  string            `json:"target"`
	Column  string            `json:"column"`
	Class   string            `json:"class,omitempty"`
	SAI     bool              `json:"sai,omitempty"`
	Options map[string]string `json:"options,omitempty"`
}

// Table is a base table.
type Table struct {
	Keyspace string   `json:"keyspace"`
	Name     string   `json:"name"`
	Columns  []Column `json:"columns"`
	Options  []Option `json:"options"`
	Indexes  []Index  `json:"indexes"`
	// Views lists materialized views built on this table.
	Views   []string `json:"views"`
	Counter bool     `json:"counter,omitempty"`
}

// View is a materialized view.
type View struct {
	Keyspace    string   `json:"keyspace"`
	Name        string   `json:"name"`
	BaseTable   string   `json:"base_table"`
	Columns     []Column `json:"columns"`
	Options     []Option `json:"options"`
	WhereClause string   `json:"where_clause"`
	IncludeAll  bool     `json:"include_all_columns"`
}

// Field is one UDT field.
type Field struct {
	Name string         `json:"name"`
	Type codec.TypeDesc `json:"type"`
	CQL  string         `json:"cql"`
}

// UDT is a user-defined type.
type UDT struct {
	Keyspace string  `json:"keyspace"`
	Name     string  `json:"name"`
	Fields   []Field `json:"fields"`
	// UsedBy lists "table.column" or "type.field" references, same keyspace first.
	UsedBy []string `json:"used_by"`
}

// Function is a user-defined function.
type Function struct {
	Keyspace     string   `json:"keyspace"`
	Name         string   `json:"name"`
	ArgNames     []string `json:"arg_names"`
	ArgTypes     []string `json:"arg_types"`
	ReturnType   string   `json:"return_type"`
	Language     string   `json:"language"`
	Body         string   `json:"body"`
	CalledOnNull bool     `json:"called_on_null_input"`
}

// Signature is name(argtypes), the form DESCRIBE FUNCTION accepts.
func (f Function) Signature() string { return f.Name + "(" + strings.Join(f.ArgTypes, ", ") + ")" }

// Aggregate is a user-defined aggregate.
type Aggregate struct {
	Keyspace   string   `json:"keyspace"`
	Name       string   `json:"name"`
	ArgTypes   []string `json:"arg_types"`
	StateFunc  string   `json:"state_func"`
	StateType  string   `json:"state_type"`
	FinalFunc  string   `json:"final_func,omitempty"`
	InitCond   string   `json:"init_cond,omitempty"`
	ReturnType string   `json:"return_type"`
}

// Signature is name(argtypes).
func (a Aggregate) Signature() string { return a.Name + "(" + strings.Join(a.ArgTypes, ", ") + ")" }

// Keyspace groups one keyspace's objects.
type Keyspace struct {
	Name          string            `json:"name"`
	System        bool              `json:"system"`
	Replication   map[string]string `json:"replication"`
	DurableWrites bool              `json:"durable_writes"`
	Tables        []Table           `json:"tables"`
	Views         []View            `json:"views"`
	Types         []UDT             `json:"types"`
	Functions     []Function        `json:"functions"`
	Aggregates    []Aggregate       `json:"aggregates"`
}

// Snapshot is the whole schema at one moment.
type Snapshot struct {
	Keyspaces []Keyspace `json:"keyspaces"`
	// Version is the release version of the node the snapshot was read from.
	Version     string    `json:"version"`
	GeneratedAt time.Time `json:"generated_at"`
}

// Keyspace returns the named keyspace.
func (s *Snapshot) Keyspace(name string) *Keyspace {
	for i := range s.Keyspaces {
		if s.Keyspaces[i].Name == name {
			return &s.Keyspaces[i]
		}
	}
	return nil
}

// Table returns the named table.
func (k *Keyspace) Table(name string) *Table {
	for i := range k.Tables {
		if k.Tables[i].Name == name {
			return &k.Tables[i]
		}
	}
	return nil
}

// View returns the named materialized view.
func (k *Keyspace) View(name string) *View {
	for i := range k.Views {
		if k.Views[i].Name == name {
			return &k.Views[i]
		}
	}
	return nil
}

// Type returns the named UDT.
func (k *Keyspace) Type(name string) *UDT {
	for i := range k.Types {
		if k.Types[i].Name == name {
			return &k.Types[i]
		}
	}
	return nil
}

// systemKeyspaces are the keyspaces Cassandra creates itself.
func isSystem(name string) bool {
	return strings.HasPrefix(name, "system") || name == "dse_system" || name == "dse_security"
}

type row = map[string]any

func fetch(ctx context.Context, s *gocql.Session, stmt string) ([]row, error) {
	it := s.Query(stmt).IterContext(ctx)
	var out []row
	for {
		m := row{}
		if !it.MapScan(m) {
			break
		}
		out = append(out, m)
	}
	if err := it.Close(); err != nil {
		return nil, fmt.Errorf("%s: %w", stmt, err)
	}
	return out, nil
}

func str(r row, k string) string {
	if v, ok := r[k].(string); ok {
		return v
	}
	return ""
}

func strs(r row, k string) []string {
	if v, ok := r[k].([]string); ok {
		return v
	}
	return []string{}
}

func boolean(r row, k string) bool {
	v, _ := r[k].(bool)
	return v
}

// ReleaseVersion reads the connected node's release version.
func ReleaseVersion(ctx context.Context, s *gocql.Session) (string, error) {
	var v string
	if err := s.Query(`SELECT release_version FROM system.local`).ScanContext(ctx, &v); err != nil {
		return "", fmt.Errorf("reading release version: %w", err)
	}
	return v, nil
}

// Build reads the schema from system_schema (Cassandra 3.0+).
func Build(ctx context.Context, s *gocql.Session) (*Snapshot, error) {
	version, err := ReleaseVersion(ctx, s)
	if err != nil {
		return nil, err
	}
	kss, err := fetch(ctx, s, `SELECT * FROM system_schema.keyspaces`)
	if err != nil {
		return nil, err
	}
	tabs, err := fetch(ctx, s, `SELECT * FROM system_schema.tables`)
	if err != nil {
		return nil, err
	}
	cols, err := fetch(ctx, s, `SELECT * FROM system_schema.columns`)
	if err != nil {
		return nil, err
	}
	views, err := fetch(ctx, s, `SELECT * FROM system_schema.views`)
	if err != nil {
		return nil, err
	}
	idxs, err := fetch(ctx, s, `SELECT * FROM system_schema.indexes`)
	if err != nil {
		return nil, err
	}
	types, err := fetch(ctx, s, `SELECT * FROM system_schema.types`)
	if err != nil {
		return nil, err
	}
	funcs, err := fetch(ctx, s, `SELECT * FROM system_schema.functions`)
	if err != nil {
		return nil, err
	}
	aggs, err := fetch(ctx, s, `SELECT * FROM system_schema.aggregates`)
	if err != nil {
		return nil, err
	}
	if err := applyNullBoolDefaults(ctx, s, "tables", "table_name", tabs); err != nil {
		return nil, err
	}
	if err := applyNullBoolDefaults(ctx, s, "views", "view_name", views); err != nil {
		return nil, err
	}
	snap := assemble(kss, tabs, cols, views, idxs, types, funcs, aggs)
	snap.Version = version
	snap.GeneratedAt = time.Now().UTC()
	return snap, nil
}

func assemble(kss, tabs, cols, views, idxs, types, funcs, aggs []row) *Snapshot {
	snap := &Snapshot{}
	byKS := map[string]*Keyspace{}
	for _, r := range kss {
		name := str(r, "keyspace_name")
		repl, _ := r["replication"].(map[string]string)
		snap.Keyspaces = append(snap.Keyspaces, Keyspace{
			Name: name, System: isSystem(name), Replication: repl, DurableWrites: boolean(r, "durable_writes"),
			Tables: []Table{}, Views: []View{}, Types: []UDT{}, Functions: []Function{}, Aggregates: []Aggregate{},
		})
	}
	sort.Slice(snap.Keyspaces, func(i, j int) bool { return snap.Keyspaces[i].Name < snap.Keyspaces[j].Name })
	for i := range snap.Keyspaces {
		byKS[snap.Keyspaces[i].Name] = &snap.Keyspaces[i]
	}

	colsBy := map[string][]Column{}
	for _, r := range cols {
		ks, tbl := str(r, "keyspace_name"), str(r, "table_name")
		colsBy[ks+"."+tbl] = append(colsBy[ks+"."+tbl], buildColumn(r, ks))
	}
	for k := range colsBy {
		sortColumns(colsBy[k])
	}

	for _, r := range types {
		ks := byKS[str(r, "keyspace_name")]
		if ks == nil {
			continue
		}
		u := UDT{Keyspace: ks.Name, Name: str(r, "type_name"), Fields: []Field{}, UsedBy: []string{}}
		ftypes := strs(r, "field_types")
		for i, n := range strs(r, "field_names") {
			f := Field{Name: n}
			if i < len(ftypes) {
				f.Type, f.CQL = parseType(ftypes[i], ks.Name)
			}
			u.Fields = append(u.Fields, f)
		}
		ks.Types = append(ks.Types, u)
	}

	for _, r := range tabs {
		ks := byKS[str(r, "keyspace_name")]
		if ks == nil {
			continue
		}
		t := Table{Keyspace: ks.Name, Name: str(r, "table_name"), Options: tableOptions(r), Indexes: []Index{}, Views: []string{}}
		t.Columns = colsBy[ks.Name+"."+t.Name]
		if t.Columns == nil {
			t.Columns = []Column{}
		}
		for _, c := range t.Columns {
			if c.Type.Name == "counter" {
				t.Counter = true
			}
		}
		ks.Tables = append(ks.Tables, t)
	}
	for _, r := range views {
		ks := byKS[str(r, "keyspace_name")]
		if ks == nil {
			continue
		}
		v := View{
			Keyspace: ks.Name, Name: str(r, "view_name"), BaseTable: str(r, "base_table_name"),
			WhereClause: str(r, "where_clause"), IncludeAll: boolean(r, "include_all_columns"), Options: tableOptions(r),
		}
		// Views cannot set a TTL and DESCRIBE leaves it out.
		v.Options = slices.DeleteFunc(v.Options, func(o Option) bool { return o.Name == "default_time_to_live" })
		v.Columns = colsBy[ks.Name+"."+v.Name]
		if v.Columns == nil {
			v.Columns = []Column{}
		}
		ks.Views = append(ks.Views, v)
	}
	for _, r := range idxs {
		ks := byKS[str(r, "keyspace_name")]
		if ks == nil {
			continue
		}
		if t := ks.Table(str(r, "table_name")); t != nil {
			t.Indexes = append(t.Indexes, buildIndex(r))
		}
	}
	for _, r := range funcs {
		ks := byKS[str(r, "keyspace_name")]
		if ks == nil {
			continue
		}
		ks.Functions = append(ks.Functions, Function{
			Keyspace: ks.Name, Name: str(r, "function_name"), ArgNames: strs(r, "argument_names"), ArgTypes: strs(r, "argument_types"),
			ReturnType: str(r, "return_type"), Language: str(r, "language"), Body: str(r, "body"), CalledOnNull: boolean(r, "called_on_null_input"),
		})
	}
	for _, r := range aggs {
		ks := byKS[str(r, "keyspace_name")]
		if ks == nil {
			continue
		}
		ks.Aggregates = append(ks.Aggregates, Aggregate{
			Keyspace: ks.Name, Name: str(r, "aggregate_name"), ArgTypes: strs(r, "argument_types"), StateFunc: str(r, "state_func"),
			StateType: str(r, "state_type"), FinalFunc: str(r, "final_func"), InitCond: str(r, "initcond"), ReturnType: str(r, "return_type"),
		})
	}

	for i := range snap.Keyspaces {
		ks := &snap.Keyspaces[i]
		sort.Slice(ks.Tables, func(a, b int) bool { return ks.Tables[a].Name < ks.Tables[b].Name })
		sort.Slice(ks.Views, func(a, b int) bool { return ks.Views[a].Name < ks.Views[b].Name })
		sort.Slice(ks.Types, func(a, b int) bool { return ks.Types[a].Name < ks.Types[b].Name })
		sort.Slice(ks.Functions, func(a, b int) bool { return ks.Functions[a].Signature() < ks.Functions[b].Signature() })
		sort.Slice(ks.Aggregates, func(a, b int) bool { return ks.Aggregates[a].Signature() < ks.Aggregates[b].Signature() })
		for _, t := range ks.Tables {
			sort.Slice(t.Indexes, func(a, b int) bool { return t.Indexes[a].Name < t.Indexes[b].Name })
		}
		for _, v := range ks.Views {
			if t := ks.Table(v.BaseTable); t != nil {
				t.Views = append(t.Views, v.Name)
			}
		}
	}
	linkTypeUsage(snap)
	return snap
}

func parseType(s, ks string) (codec.TypeDesc, string) {
	t, err := codec.Parse(s, ks)
	if err != nil {
		// Unknown syntax: keep the raw text so the UI still shows something.
		return codec.TypeDesc{Name: s}, s
	}
	return t, s
}

func buildColumn(r row, ks string) Column {
	c := Column{Name: str(r, "column_name")}
	c.Type, c.CQL = parseType(str(r, "type"), ks)
	pos, _ := r["position"].(int)
	switch str(r, "kind") {
	case "partition_key":
		c.Kind, c.Position = KindPartition, pos+1
	case "clustering":
		c.Kind, c.Position = KindClustering, pos+1
		c.Order = "ASC"
		if strings.EqualFold(str(r, "clustering_order"), "desc") {
			c.Order = "DESC"
		}
	case "static":
		c.Kind = KindStatic
	default:
		c.Kind = KindRegular
	}
	return c
}

// isComplex reports multi-cell (non-frozen) collections and UDTs, which Cassandra lists after simple columns.
func isComplex(c Column) bool {
	if c.Type.Frozen {
		return false
	}
	switch c.Type.Name {
	case "list", "set", "map":
		return true
	}
	return c.Type.UDT != nil
}

// sortColumns orders columns the way Cassandra's DESCRIBE does: partition key, clustering
// columns, static columns, then regular columns; within the last two, simple before multi-cell
// and alphabetical.
func sortColumns(cols []Column) {
	rank := func(c Column) int {
		switch c.Kind {
		case KindPartition:
			return 0
		case KindClustering:
			return 1
		case KindStatic:
			return 2
		}
		return 4
	}
	sort.SliceStable(cols, func(i, j int) bool {
		a, b := cols[i], cols[j]
		if ra, rb := rank(a), rank(b); ra != rb {
			return ra < rb
		}
		if a.Kind == KindPartition || a.Kind == KindClustering {
			return a.Position < b.Position
		}
		if ca, cb := isComplex(a), isComplex(b); ca != cb {
			return !ca
		}
		return a.Name < b.Name
	})
}

func linkTypeUsage(snap *Snapshot) {
	udts := map[string]*UDT{}
	for i := range snap.Keyspaces {
		for j := range snap.Keyspaces[i].Types {
			u := &snap.Keyspaces[i].Types[j]
			udts[u.Keyspace+"."+u.Name] = u
		}
	}
	add := func(t codec.TypeDesc, who string) {
		t.Walk(func(d codec.TypeDesc) {
			if d.UDT == nil {
				return
			}
			if u := udts[d.UDT.Keyspace+"."+d.UDT.Name]; u != nil && !contains(u.UsedBy, who) {
				u.UsedBy = append(u.UsedBy, who)
			}
		})
	}
	for i := range snap.Keyspaces {
		ks := &snap.Keyspaces[i]
		for _, t := range ks.Tables {
			for _, c := range t.Columns {
				add(c.Type, t.Name+"."+c.Name)
			}
		}
		for _, v := range ks.Views {
			for _, c := range v.Columns {
				add(c.Type, v.Name+"."+c.Name)
			}
		}
		for _, u := range ks.Types {
			for _, f := range u.Fields {
				add(f.Type, u.Name+"."+f.Name)
			}
		}
	}
	for _, u := range udts {
		sort.Strings(u.UsedBy)
	}
}

func contains(l []string, s string) bool {
	for _, x := range l {
		if x == s {
			return true
		}
	}
	return false
}

func buildIndex(r row) Index {
	opts, _ := r["options"].(map[string]string)
	i := Index{Name: str(r, "index_name"), Kind: strings.ToLower(str(r, "kind")), Target: opts["target"], Class: opts["class_name"]}
	i.Column = i.Target
	if open := strings.IndexByte(i.Target, '('); open > 0 && strings.HasSuffix(i.Target, ")") {
		i.Column = i.Target[open+1 : len(i.Target)-1]
	}
	i.Column = strings.Trim(i.Column, `"`)
	i.SAI = strings.EqualFold(i.Class, "sai") || strings.HasSuffix(i.Class, "StorageAttachedIndex")
	for k, v := range opts {
		if k == "target" || k == "class_name" {
			continue
		}
		if i.Options == nil {
			i.Options = map[string]string{}
		}
		i.Options[k] = v
	}
	return i
}

// nullDefaultTrue are boolean table options whose default is true; the driver reports a null
// column as false, so the real value is read separately.
var nullDefaultTrue = []string{"allow_auto_snapshot", "incremental_backups"}

func applyNullBoolDefaults(ctx context.Context, s *gocql.Session, table, nameCol string, rows []row) error {
	if len(rows) == 0 {
		return nil
	}
	for _, col := range nullDefaultTrue {
		if _, ok := rows[0][col]; !ok {
			continue
		}
		stmt := fmt.Sprintf(`SELECT keyspace_name, %s, %s FROM system_schema.%s`, nameCol, col, table)
		it := s.Query(stmt).IterContext(ctx)
		vals := map[string]bool{}
		var ks, name string
		var v *bool
		for it.Scan(&ks, &name, &v) {
			vals[ks+"."+name] = v == nil || *v
			v = nil
		}
		if err := it.Close(); err != nil {
			return fmt.Errorf("%s: %w", stmt, err)
		}
		for _, r := range rows {
			if b, ok := vals[str(r, "keyspace_name")+"."+str(r, nameCol)]; ok {
				r[col] = b
			}
		}
	}
	return nil
}
