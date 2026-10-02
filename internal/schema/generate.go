package schema

import (
	"fmt"
	"sort"
	"strings"

	"github.com/0funct0ry/helenus/internal/codec"
)

var reserved = map[string]bool{
	"add": true, "allow": true, "alter": true, "and": true, "apply": true, "asc": true, "authorize": true, "batch": true,
	"begin": true, "by": true, "columnfamily": true, "create": true, "delete": true, "desc": true, "describe": true,
	"drop": true, "entries": true, "execute": true, "from": true, "full": true, "grant": true, "if": true, "in": true,
	"index": true, "infinity": true, "insert": true, "into": true, "is": true, "keyspace": true, "limit": true,
	"materialized": true, "modify": true, "nan": true, "norecursive": true, "not": true, "null": true, "of": true,
	"on": true, "or": true, "order": true, "primary": true, "rename": true, "replace": true, "revoke": true,
	"schema": true, "select": true, "set": true, "table": true, "to": true, "token": true, "truncate": true,
	"unlogged": true, "update": true, "use": true, "using": true, "view": true, "where": true, "with": true,
}

// Ident quotes an identifier when CQL requires it.
func Ident(id string) string {
	ok := id != ""
	for i, r := range id {
		if !(r == '_' || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9' && i > 0)) {
			ok = false
			break
		}
	}
	if ok && !reserved[id] {
		return id
	}
	return `"` + strings.ReplaceAll(id, `"`, `""`) + `"`
}

func qname(ks, name string) string { return Ident(ks) + "." + Ident(name) }

// KeyspaceDDL renders CREATE KEYSPACE.
func KeyspaceDDL(k Keyspace) string {
	repl := map[string]string{}
	for key, v := range k.Replication {
		repl[key] = v
	}
	parts := []string{}
	if c, ok := repl["class"]; ok {
		parts = append(parts, quote("class")+": "+quote(strings.TrimPrefix(c, "org.apache.cassandra.locator.")))
		delete(repl, "class")
	}
	keys := make([]string, 0, len(repl))
	for key := range repl {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		parts = append(parts, quote(key)+": "+quote(repl[key]))
	}
	return fmt.Sprintf("CREATE KEYSPACE %s WITH replication = {%s}  AND durable_writes = %t;", Ident(k.Name), strings.Join(parts, ", "), k.DurableWrites)
}

// TypeDDL renders CREATE TYPE.
func TypeDDL(u UDT) string {
	fields := make([]string, len(u.Fields))
	for i, f := range u.Fields {
		fields[i] = "    " + Ident(f.Name) + " " + f.CQL
	}
	return fmt.Sprintf("CREATE TYPE %s (\n%s\n);", qname(u.Keyspace, u.Name), strings.Join(fields, ",\n"))
}

func columnLines(cols []Column, inlinePK bool) []string {
	lines := make([]string, len(cols))
	for i, c := range cols {
		l := "    " + Ident(c.Name) + " " + c.CQL
		if c.Kind == KindStatic {
			l += " static"
		}
		if inlinePK && c.Kind == KindPartition {
			l += " PRIMARY KEY"
		}
		lines[i] = l
	}
	return lines
}

func keyClause(cols []Column) (clause string, single bool) {
	var pk, ck []string
	for _, c := range cols {
		switch c.Kind {
		case KindPartition:
			pk = append(pk, Ident(c.Name))
		case KindClustering:
			ck = append(ck, Ident(c.Name))
		}
	}
	single = len(pk) == 1 && len(ck) == 0
	part := pk[0]
	if len(pk) > 1 {
		part = "(" + strings.Join(pk, ", ") + ")"
	}
	return strings.Join(append([]string{part}, ck...), ", "), single
}

func clusteringOrder(cols []Column) string {
	var parts []string
	for _, c := range cols {
		if c.Kind == KindClustering {
			parts = append(parts, Ident(c.Name)+" "+c.Order)
		}
	}
	return strings.Join(parts, ", ")
}

// optionsClause renders " WITH ..." / "\n    AND ..." for the given leading clause.
func optionsClause(lead string, opts []Option) string {
	var b strings.Builder
	first := lead == ""
	if lead != "" {
		b.WriteString(" WITH " + lead)
	}
	for _, o := range opts {
		if first {
			b.WriteString(" WITH " + o.Name + " = " + o.Value)
			first = false
			continue
		}
		b.WriteString("\n    AND " + o.Name + " = " + o.Value)
	}
	return b.String()
}

// TableDDL renders CREATE TABLE (without indexes).
func TableDDL(t Table) string {
	clause, single := keyClause(t.Columns)
	lines := columnLines(t.Columns, single)
	if !single {
		lines = append(lines, "    PRIMARY KEY ("+clause+")")
	}
	lead := ""
	if order := clusteringOrder(t.Columns); order != "" {
		lead = "CLUSTERING ORDER BY (" + order + ")"
	}
	return fmt.Sprintf("CREATE TABLE %s (\n%s\n)%s;", qname(t.Keyspace, t.Name), strings.Join(lines, ",\n"), optionsClause(lead, t.Options))
}

// IndexDDL renders CREATE INDEX or CREATE CUSTOM INDEX.
func IndexDDL(keyspace, table string, i Index) string {
	if i.Kind == "custom" {
		s := fmt.Sprintf("CREATE CUSTOM INDEX %s ON %s (%s) USING %s", Ident(i.Name), qname(keyspace, table), i.Target, quote(i.Class))
		if len(i.Options) > 0 {
			s += " WITH OPTIONS = " + literalMap(i.Options)
		}
		return s + ";"
	}
	return fmt.Sprintf("CREATE INDEX %s ON %s (%s);", Ident(i.Name), qname(keyspace, table), i.Target)
}

// ViewDDL renders CREATE MATERIALIZED VIEW.
func ViewDDL(v View) string {
	sel := "*"
	if !v.IncludeAll {
		names := make([]string, len(v.Columns))
		for i, c := range v.Columns {
			names[i] = Ident(c.Name)
		}
		sel = strings.Join(names, ", ")
	}
	clause, _ := keyClause(v.Columns)
	lead := ""
	if order := clusteringOrder(v.Columns); order != "" {
		lead = "CLUSTERING ORDER BY (" + order + ")"
	}
	return fmt.Sprintf("CREATE MATERIALIZED VIEW %s AS\n    SELECT %s\n    FROM %s\n    WHERE %s\n    PRIMARY KEY (%s)\n%s;",
		qname(v.Keyspace, v.Name), sel, qname(v.Keyspace, v.BaseTable), v.WhereClause, clause,
		optionsClause(lead, v.Options))
}

// FunctionDDL renders CREATE FUNCTION.
func FunctionDDL(f Function) string {
	args := make([]string, len(f.ArgTypes))
	for i, t := range f.ArgTypes {
		args[i] = Ident(f.ArgNames[i]) + " " + t
	}
	null := "RETURNS NULL ON NULL INPUT"
	if f.CalledOnNull {
		null = "CALLED ON NULL INPUT"
	}
	return fmt.Sprintf("CREATE FUNCTION %s(%s)\n    %s\n    RETURNS %s\n    LANGUAGE %s\n    AS $$%s$$;",
		qname(f.Keyspace, f.Name), strings.Join(args, ", "), null, f.ReturnType, f.Language, f.Body)
}

// AggregateDDL renders CREATE AGGREGATE.
func AggregateDDL(a Aggregate) string {
	s := fmt.Sprintf("CREATE AGGREGATE %s(%s)\n    SFUNC %s\n    STYPE %s", qname(a.Keyspace, a.Name), strings.Join(a.ArgTypes, ", "), Ident(a.StateFunc), a.StateType)
	if a.FinalFunc != "" {
		s += "\n    FINALFUNC " + Ident(a.FinalFunc)
	}
	if a.InitCond != "" {
		s += "\n    INITCOND " + a.InitCond
	}
	return s + ";"
}

// typesInDependencyOrder lists a keyspace's UDTs so each follows the types it references.
func typesInDependencyOrder(k Keyspace) []UDT {
	byName := map[string]UDT{}
	for _, u := range k.Types {
		byName[u.Name] = u
	}
	var out []UDT
	done := map[string]bool{}
	var visit func(u UDT)
	visit = func(u UDT) {
		if done[u.Name] {
			return
		}
		done[u.Name] = true
		for _, f := range u.Fields {
			f.Type.Walk(func(d codec.TypeDesc) {
				if d.UDT != nil && d.UDT.Keyspace == k.Name {
					if dep, ok := byName[d.UDT.Name]; ok {
						visit(dep)
					}
				}
			})
		}
		out = append(out, u)
	}
	for _, u := range k.Types {
		visit(u)
	}
	return out
}

// KeyspaceSchemaDDL renders a keyspace and everything in it, one statement per element.
func KeyspaceSchemaDDL(k Keyspace) []string {
	out := []string{KeyspaceDDL(k)}
	for _, u := range typesInDependencyOrder(k) {
		out = append(out, TypeDDL(u))
	}
	for _, f := range k.Functions {
		out = append(out, FunctionDDL(f))
	}
	for _, a := range k.Aggregates {
		out = append(out, AggregateDDL(a))
	}
	for _, t := range k.Tables {
		out = append(out, TableDDL(t))
		for _, i := range t.Indexes {
			out = append(out, IndexDDL(t.Keyspace, t.Name, i))
		}
	}
	for _, v := range k.Views {
		out = append(out, ViewDDL(v))
	}
	return out
}
