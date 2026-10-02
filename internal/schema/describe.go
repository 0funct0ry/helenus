package schema

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
)

// TargetKind is what a DESCRIBE statement asks for.
type TargetKind int

// DESCRIBE forms (SPEC §8.3).
const (
	Cluster TargetKind = iota
	Keyspaces
	KeyspaceT
	Tables
	TableT
	Types
	TypeT
	ViewT
	IndexT
	Functions
	FunctionT
	Aggregates
	AggregateT
	SchemaT
	FullSchema
	// Bare is DESCRIBE <name>: the first of keyspace, table, view, index, type, function, aggregate that matches.
	Bare
)

// Target is a parsed DESCRIBE statement.
type Target struct {
	Kind     TargetKind
	Keyspace string
	Name     string
}

// ErrNoKeyspace is returned when a DESCRIBE needs a keyspace and none is current.
var ErrNoKeyspace = errors.New("no keyspace specified and no current keyspace")

// splitWords tokenizes on whitespace, keeping "double quoted" identifiers whole.
func splitWords(s string) ([]string, error) {
	var out []string
	var cur strings.Builder
	inQ := false
	for _, r := range s {
		switch {
		case r == '"':
			inQ = !inQ
			cur.WriteRune(r)
		case !inQ && (r == ' ' || r == '\t' || r == '\n'):
			if cur.Len() > 0 {
				out = append(out, cur.String())
				cur.Reset()
			}
		default:
			cur.WriteRune(r)
		}
	}
	if inQ {
		return nil, errors.New("unterminated quoted identifier")
	}
	if cur.Len() > 0 {
		out = append(out, cur.String())
	}
	return out, nil
}

// unquoteName splits [ks.]name, removing double quotes and keeping case of quoted parts.
func unquoteName(w string) (ks, name string, err error) {
	var parts []string
	var cur strings.Builder
	inQ, quoted := false, false
	flush := func() {
		s := cur.String()
		if !quoted {
			s = strings.ToLower(s)
		}
		parts = append(parts, s)
		cur.Reset()
		quoted = false
	}
	rs := []rune(w)
	for i := 0; i < len(rs); i++ {
		r := rs[i]
		switch {
		case r == '"' && inQ && i+1 < len(rs) && rs[i+1] == '"':
			cur.WriteRune('"')
			i++
		case r == '"':
			inQ, quoted = !inQ, true
		case r == '.' && !inQ:
			flush()
		default:
			cur.WriteRune(r)
		}
	}
	flush()
	switch len(parts) {
	case 1:
		return "", parts[0], nil
	case 2:
		return parts[0], parts[1], nil
	}
	return "", "", fmt.Errorf("invalid name %q", w)
}

// ParseDescribe parses the text after (or including) DESCRIBE / DESC. It accepts a trailing semicolon.
func ParseDescribe(text string) (Target, error) {
	text = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(text), ";"))
	words, err := splitWords(text)
	if err != nil {
		return Target{}, err
	}
	if len(words) > 0 && (strings.EqualFold(words[0], "describe") || strings.EqualFold(words[0], "desc")) {
		words = words[1:]
	}
	if len(words) == 0 {
		return Target{}, errors.New("DESCRIBE what? Try DESCRIBE KEYSPACES, TABLES, TABLE <name> or SCHEMA")
	}
	kw := strings.ToUpper(words[0])
	rest := words[1:]
	if kw == "MATERIALIZED" {
		if len(rest) == 0 || !strings.EqualFold(rest[0], "VIEW") {
			return Target{}, errors.New("expected DESCRIBE MATERIALIZED VIEW <name>")
		}
		kw, rest = "VIEW", rest[1:]
	}
	if kw == "FULL" {
		if len(rest) != 1 || !strings.EqualFold(rest[0], "SCHEMA") {
			return Target{}, errors.New("expected DESCRIBE FULL SCHEMA")
		}
		return Target{Kind: FullSchema}, nil
	}
	simple := map[string]TargetKind{"CLUSTER": Cluster, "KEYSPACES": Keyspaces, "TABLES": Tables, "TYPES": Types, "FUNCTIONS": Functions, "AGGREGATES": Aggregates, "SCHEMA": SchemaT}
	if k, ok := simple[kw]; ok {
		if len(rest) != 0 {
			return Target{}, fmt.Errorf("DESCRIBE %s takes no argument", kw)
		}
		return Target{Kind: k}, nil
	}
	named := map[string]TargetKind{"KEYSPACE": KeyspaceT, "TABLE": TableT, "COLUMNFAMILY": TableT, "TYPE": TypeT, "VIEW": ViewT, "INDEX": IndexT, "FUNCTION": FunctionT, "AGGREGATE": AggregateT}
	if k, ok := named[kw]; ok {
		if len(rest) == 0 {
			if k == KeyspaceT {
				return Target{Kind: k}, nil
			}
			return Target{}, fmt.Errorf("DESCRIBE %s needs a name", kw)
		}
		if len(rest) > 1 {
			return Target{}, fmt.Errorf("unexpected %q", rest[1])
		}
		if k == KeyspaceT {
			_, n, err := unquoteName(rest[0])
			return Target{Kind: k, Name: n}, err
		}
		ks, n, err := unquoteName(rest[0])
		return Target{Kind: k, Keyspace: ks, Name: n}, err
	}
	if len(words) == 1 {
		ks, n, err := unquoteName(words[0])
		return Target{Kind: Bare, Keyspace: ks, Name: n}, err
	}
	return Target{}, fmt.Errorf("unknown DESCRIBE target %q", words[0])
}

// Statement renders t as a server-side DESCRIBE, qualifying names with currentKS when needed.
func (t Target) Statement(currentKS string) string {
	q := func() string {
		ks := t.Keyspace
		if ks == "" {
			ks = currentKS
		}
		if ks == "" {
			return Ident(t.Name)
		}
		return qname(ks, t.Name)
	}
	switch t.Kind {
	case Cluster:
		return "DESCRIBE CLUSTER"
	case Keyspaces:
		return "DESCRIBE KEYSPACES"
	case KeyspaceT:
		if t.Name == "" {
			if currentKS == "" {
				return "DESCRIBE KEYSPACE"
			}
			return "DESCRIBE KEYSPACE " + Ident(currentKS)
		}
		return "DESCRIBE KEYSPACE " + Ident(t.Name)
	case Tables:
		return "DESCRIBE TABLES"
	case TableT:
		return "DESCRIBE TABLE " + q()
	case Types:
		return "DESCRIBE TYPES"
	case TypeT:
		return "DESCRIBE TYPE " + q()
	case ViewT:
		return "DESCRIBE MATERIALIZED VIEW " + q()
	case IndexT:
		return "DESCRIBE INDEX " + q()
	case Functions:
		return "DESCRIBE FUNCTIONS"
	case FunctionT:
		return "DESCRIBE FUNCTION " + q()
	case Aggregates:
		return "DESCRIBE AGGREGATES"
	case AggregateT:
		return "DESCRIBE AGGREGATE " + q()
	case SchemaT:
		return "DESCRIBE SCHEMA"
	case FullSchema:
		return "DESCRIBE FULL SCHEMA"
	}
	return "DESCRIBE " + q()
}

// MajorVersion returns the leading number of a release version, or 0.
func MajorVersion(v string) int {
	n, _ := strconv.Atoi(strings.SplitN(v, ".", 2)[0])
	return n
}

// Describe returns the DESCRIBE output for t as text. Cassandra 4.0+ answers server-side;
// 3.x output is generated from snap. currentKS qualifies bare names.
func Describe(ctx context.Context, s *gocql.Session, snap *Snapshot, t Target, currentKS string) (string, error) {
	if MajorVersion(snap.Version) >= 4 {
		return describeServer(ctx, s, t, currentKS)
	}
	return Generate(snap, t, currentKS)
}

func describeServer(ctx context.Context, s *gocql.Session, t Target, currentKS string) (string, error) {
	rows, err := fetch(ctx, s, t.Statement(currentKS))
	if err != nil {
		return "", err
	}
	return formatRows(t, rows), nil
}

// statementsText prints statements the way cqlsh does: a blank line before and after each.
func statementsText(stmts []string) string {
	var b strings.Builder
	for _, st := range stmts {
		b.WriteString("\n" + st + "\n")
	}
	return b.String()
}

func formatRows(t Target, rows []row) string {
	if len(rows) == 0 {
		return ""
	}
	if _, ok := rows[0]["create_statement"]; ok {
		stmts := make([]string, 0, len(rows))
		for _, r := range rows {
			stmts = append(stmts, strings.TrimRight(str(r, "create_statement"), "\n"))
		}
		return statementsText(stmts)
	}
	if t.Kind == Cluster {
		var b strings.Builder
		b.WriteString("\n")
		for _, r := range rows {
			keys := make([]string, 0, len(r))
			for k := range r {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			for _, k := range keys {
				fmt.Fprintf(&b, "%s: %v\n", clusterLabel(k), r[k])
			}
		}
		b.WriteString("\n")
		return b.String()
	}
	groups := map[string][]string{}
	var order []string
	for _, r := range rows {
		ks := str(r, "keyspace_name")
		if _, ok := groups[ks]; !ok {
			order = append(order, ks)
		}
		groups[ks] = append(groups[ks], str(r, "name"))
	}
	if t.Kind == Keyspaces {
		return "\n" + columnize(order) + "\n\n"
	}
	return listing(order, groups)
}

func clusterLabel(k string) string {
	if k == "" {
		return k
	}
	return strings.ToUpper(k[:1]) + k[1:]
}

// columnize joins names with two spaces, wrapping at 80 columns.
func columnize(names []string) string {
	var b strings.Builder
	width := 0
	for i, n := range names {
		if i > 0 {
			if width+2+len(n) > 80 {
				b.WriteString("\n")
				width = 0
			} else {
				b.WriteString("  ")
				width += 2
			}
		}
		b.WriteString(n)
		width += len(n)
	}
	return b.String()
}

func listing(order []string, groups map[string][]string) string {
	var b strings.Builder
	for _, ks := range order {
		title := "Keyspace " + ks
		fmt.Fprintf(&b, "\n%s\n%s\n%s\n", title, strings.Repeat("-", len(title)), columnize(groups[ks]))
	}
	b.WriteString("\n")
	return b.String()
}

// Generate renders DESCRIBE output from the snapshot, for clusters that cannot answer it themselves.
func Generate(snap *Snapshot, t Target, currentKS string) (string, error) {
	resolve := func(ks string) (*Keyspace, error) {
		if ks == "" {
			ks = currentKS
		}
		if ks == "" {
			return nil, ErrNoKeyspace
		}
		k := snap.Keyspace(ks)
		if k == nil {
			return nil, fmt.Errorf("keyspace '%s' not found", ks)
		}
		return k, nil
	}
	notFound := func(what, name string) error { return fmt.Errorf("%s '%s' not found", what, name) }

	switch t.Kind {
	case Bare:
		if t.Keyspace == "" {
			if k := snap.Keyspace(t.Name); k != nil {
				return Generate(snap, Target{Kind: KeyspaceT, Name: t.Name}, currentKS)
			}
		}
		for _, kind := range []TargetKind{TableT, ViewT, IndexT, TypeT, FunctionT, AggregateT} {
			if out, err := Generate(snap, Target{Kind: kind, Keyspace: t.Keyspace, Name: t.Name}, currentKS); err == nil {
				return out, nil
			}
		}
		return "", fmt.Errorf("'%s' not found in keyspaces, tables, views, indexes, types, functions or aggregates", t.Name)
	case Cluster:
		return "", errors.New("DESCRIBE CLUSTER needs Cassandra 4.0 or newer")
	case Keyspaces:
		names := []string{}
		for _, k := range snap.Keyspaces {
			names = append(names, k.Name)
		}
		return "\n" + columnize(names) + "\n\n", nil
	case KeyspaceT:
		name := t.Name
		if name == "" {
			name = currentKS
		}
		k, err := resolve(name)
		if err != nil {
			return "", err
		}
		return statementsText(KeyspaceSchemaDDL(*k)), nil
	case SchemaT, FullSchema:
		var stmts []string
		for _, k := range snap.Keyspaces {
			if k.System && t.Kind == SchemaT {
				continue
			}
			stmts = append(stmts, KeyspaceSchemaDDL(k)...)
		}
		return statementsText(stmts), nil
	case Tables, Types, Functions, Aggregates:
		groups := map[string][]string{}
		var order []string
		for _, k := range snap.Keyspaces {
			var names []string
			switch t.Kind {
			case Tables:
				for _, x := range k.Tables {
					names = append(names, x.Name)
				}
				for _, x := range k.Views {
					names = append(names, x.Name)
				}
				sort.Strings(names)
			case Types:
				for _, x := range k.Types {
					names = append(names, x.Name)
				}
			case Functions:
				for _, x := range k.Functions {
					names = append(names, x.Signature())
				}
			default:
				for _, x := range k.Aggregates {
					names = append(names, x.Signature())
				}
			}
			if len(names) > 0 {
				order = append(order, k.Name)
				groups[k.Name] = names
			}
		}
		return listing(order, groups), nil
	}

	k, err := resolve(t.Keyspace)
	if err != nil {
		return "", err
	}
	switch t.Kind {
	case TableT:
		tb := k.Table(t.Name)
		if tb == nil {
			return "", notFound("Table", t.Name)
		}
		stmts := []string{TableDDL(*tb)}
		for _, i := range tb.Indexes {
			stmts = append(stmts, IndexDDL(tb.Keyspace, tb.Name, i))
		}
		if MajorVersion(snap.Version) >= 5 {
			// 5.0 includes dependent materialized views in DESCRIBE TABLE.
			for _, v := range k.Views {
				if v.BaseTable == tb.Name {
					stmts = append(stmts, ViewDDL(v))
				}
			}
		}
		return statementsText(stmts), nil
	case ViewT:
		v := k.View(t.Name)
		if v == nil {
			return "", notFound("Materialized view", t.Name)
		}
		return statementsText([]string{ViewDDL(*v)}), nil
	case IndexT:
		for _, tb := range k.Tables {
			for _, i := range tb.Indexes {
				if i.Name == t.Name {
					return statementsText([]string{IndexDDL(tb.Keyspace, tb.Name, i)}), nil
				}
			}
		}
		return "", notFound("Index", t.Name)
	case TypeT:
		u := k.Type(t.Name)
		if u == nil {
			return "", notFound("Type", t.Name)
		}
		return statementsText([]string{TypeDDL(*u)}), nil
	case FunctionT:
		var stmts []string
		for _, f := range k.Functions {
			if f.Name == t.Name {
				stmts = append(stmts, FunctionDDL(f))
			}
		}
		if stmts == nil {
			return "", notFound("Function", t.Name)
		}
		return statementsText(stmts), nil
	case AggregateT:
		var stmts []string
		for _, a := range k.Aggregates {
			if a.Name == t.Name {
				stmts = append(stmts, AggregateDDL(a))
			}
		}
		if stmts == nil {
			return "", notFound("Aggregate", t.Name)
		}
		return statementsText(stmts), nil
	}
	return "", errors.New("unsupported DESCRIBE form")
}
