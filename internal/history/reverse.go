package history

import (
	"fmt"
	"strings"

	"github.com/0funct0ry/helenus/internal/cql"
	"github.com/0funct0ry/helenus/internal/schema"
)

func qual(ks, name string) string {
	if ks == "" {
		return schema.Ident(name)
	}
	return schema.Ident(ks) + "." + schema.Ident(name)
}

var kindKeyword = map[string]string{
	"keyspace": "KEYSPACE", "table": "TABLE", "view": "MATERIALIZED VIEW", "type": "TYPE", "index": "INDEX",
	"function": "FUNCTION", "aggregate": "AGGREGATE", "trigger": "TRIGGER", "role": "ROLE",
}

func (s *stmt) reverse(before *schema.Snapshot) (string, string, bool) {
	in := s.info
	switch in.Action {
	case "create":
		return s.reverseCreate()
	case "drop":
		return s.reverseDrop(before)
	case "alter":
		return s.reverseAlter(before)
	case "grant", "revoke":
		return s.reverseGrant()
	case "truncate":
		return "", NoteTruncate, false
	}
	return "", "", false
}

func (s *stmt) reverseCreate() (string, string, bool) {
	in := s.info
	if in.Name == "" {
		return "", "", false
	}
	switch in.Kind {
	case "keyspace":
		return "DROP KEYSPACE " + schema.Ident(in.Name) + ";", "", true
	case "role":
		return "DROP ROLE " + schema.Ident(in.Name) + ";", "", true
	case "trigger":
		if s.onTable == "" {
			return "", "", false
		}
		return fmt.Sprintf("DROP TRIGGER %s ON %s;", schema.Ident(in.Name), qual(s.onKS, s.onTable)), "", true
	case "function", "aggregate":
		sig := ""
		if s.hasSig {
			sig = "(" + strings.Join(s.sig, ", ") + ")"
		}
		return fmt.Sprintf("DROP %s %s%s;", kindKeyword[in.Kind], qual(in.Keyspace, in.Name), sig), "", true
	}
	kw, ok := kindKeyword[in.Kind]
	if !ok {
		return "", "", false
	}
	return fmt.Sprintf("DROP %s %s;", kw, qual(in.Keyspace, in.Name)), "", true
}

func (s *stmt) reverseDrop(before *schema.Snapshot) (string, string, bool) {
	in := s.info
	if before == nil || in.Name == "" {
		return "", "", false
	}
	var out string
	switch in.Kind {
	case "keyspace":
		out = generate(before, schema.Target{Kind: schema.KeyspaceT, Name: in.Name})
	case "table":
		out = generate(before, schema.Target{Kind: schema.TableT, Keyspace: in.Keyspace, Name: in.Name})
	case "view":
		out = generate(before, schema.Target{Kind: schema.ViewT, Keyspace: in.Keyspace, Name: in.Name})
	case "type":
		out = generate(before, schema.Target{Kind: schema.TypeT, Keyspace: in.Keyspace, Name: in.Name})
	case "index":
		out = generate(before, schema.Target{Kind: schema.IndexT, Keyspace: in.Keyspace, Name: in.Name})
	case "function":
		if k := before.Keyspace(in.Keyspace); k != nil {
			var parts []string
			for _, f := range k.Functions {
				if f.Name == in.Name && (!s.hasSig || sameSig(f.ArgTypes, s.sig)) {
					parts = append(parts, schema.FunctionDDL(f))
				}
			}
			out = strings.Join(parts, "\n")
		}
	case "aggregate":
		if k := before.Keyspace(in.Keyspace); k != nil {
			var parts []string
			for _, a := range k.Aggregates {
				if a.Name == in.Name && (!s.hasSig || sameSig(a.ArgTypes, s.sig)) {
					parts = append(parts, schema.AggregateDDL(a))
				}
			}
			out = strings.Join(parts, "\n")
		}
	case "trigger":
		out = s.dropTrigger(before)
	}
	if strings.TrimSpace(out) == "" {
		return "", "", false
	}
	return strings.TrimSpace(out), NoteRecreate, true
}

// dropTrigger re-creates DROP TRIGGER name ON table from the before-snapshot.
func (s *stmt) dropTrigger(before *schema.Snapshot) string {
	ks := s.info.Keyspace
	tb := ""
	if s.up(s.rest) == "ON" {
		var ok bool
		var k string
		k, tb, _, ok = s.name(s.rest+1, ks)
		if !ok {
			return ""
		}
		ks = k
	}
	k := before.Keyspace(ks)
	if k == nil {
		return ""
	}
	for _, t := range k.Tables {
		if tb != "" && t.Name != tb {
			continue
		}
		for _, tr := range t.Triggers {
			if tr.Name == s.info.Name {
				return fmt.Sprintf("CREATE TRIGGER %s ON %s USING %s;", schema.Ident(tr.Name), qual(t.Keyspace, t.Name), cql.QuoteString(tr.Class))
			}
		}
	}
	return ""
}

func sameSig(have, want []string) bool {
	if len(have) != len(want) {
		return false
	}
	for i := range have {
		if normalizeType(have[i]) != want[i] {
			return false
		}
	}
	return true
}

func generate(snap *schema.Snapshot, t schema.Target) string {
	out, err := schema.Generate(snap, t, "")
	if err != nil {
		return ""
	}
	return out
}

func (s *stmt) reverseGrant() (string, string, bool) {
	// Swap the verb and the last TO/FROM.
	from, to := "TO", "FROM"
	verb, other := "GRANT", "REVOKE"
	if s.info.Action == "revoke" {
		from, to = "FROM", "TO"
		verb, other = "REVOKE", "GRANT"
	}
	idx := -1
	for j := len(s.toks) - 2; j > 0; j-- {
		if s.up(j) == from {
			idx = j
			break
		}
	}
	if idx < 0 || s.up(0) != verb {
		return "", "", false
	}
	body := strings.TrimRight(strings.TrimSpace(s.src), ";")
	t0, ti := s.toks[0], s.toks[idx]
	out := other + body[t0.End:ti.Start] + to + body[ti.End:]
	return strings.TrimSpace(out) + ";", "", true
}

func (s *stmt) reverseAlter(before *schema.Snapshot) (string, string, bool) {
	in := s.info
	if in.Name == "" {
		return "", "", false
	}
	switch in.Kind {
	case "role":
		for _, t := range s.toks {
			if t.Upper() == passwordKeyword {
				return "", NotePassword, false
			}
		}
		return "", "", false
	case "keyspace":
		return s.alterKeyspace(before)
	case "table", "view":
		return s.alterRelation(before)
	case "type":
		return s.alterType()
	}
	return "", "", false
}

func (s *stmt) alterKeyspace(before *schema.Snapshot) (string, string, bool) {
	if before == nil {
		return "", "", false
	}
	k := before.Keyspace(s.info.Name)
	if k == nil {
		return "", "", false
	}
	ddl := schema.KeyspaceDDL(*k)
	ddl = strings.Replace(ddl, "CREATE KEYSPACE", "ALTER KEYSPACE", 1)
	ddl = strings.Replace(ddl, "}  AND", "} AND", 1)
	return ddl, "", true
}

func (s *stmt) alterType() (string, string, bool) {
	target := qual(s.info.Keyspace, s.info.Name)
	switch s.up(s.rest) {
	case "ADD":
		return "", NoteNoUDTRemove, false
	case "RENAME":
		pairs, ok := s.renamePairs(s.rest + 1)
		if !ok {
			return "", "", false
		}
		return "ALTER TYPE " + target + " RENAME " + pairs + ";", "", true
	}
	return "", "", false
}

// renamePairs reverses "a TO b AND c TO d" into "b TO a AND d TO c".
func (s *stmt) renamePairs(from int) (string, bool) {
	var out []string
	for _, part := range splitTop(s.toks[from:], isAnd) {
		if len(part) != 3 || part[1].Upper() != "TO" || !isName(part[0]) || !isName(part[2]) {
			return "", false
		}
		out = append(out, ident(part[2])+" TO "+ident(part[0]))
	}
	return strings.Join(out, " AND "), len(out) > 0
}

func (s *stmt) alterRelation(before *schema.Snapshot) (string, string, bool) {
	in := s.info
	kw := kindKeyword[in.Kind]
	target := qual(in.Keyspace, in.Name)
	switch s.up(s.rest) {
	case "ADD":
		if in.Kind != "table" {
			return "", "", false
		}
		var names []string
		for _, def := range s.columnDefs(s.rest + 1) {
			names = append(names, ident(def[0]))
		}
		if len(names) == 0 {
			return "", "", false
		}
		return "ALTER TABLE " + target + " DROP " + listOrParen(names) + ";", NoteDroppedData, true
	case "DROP":
		if in.Kind != "table" || before == nil {
			return "", "", false
		}
		tb := tableOf(before, in.Keyspace, in.Name)
		if tb == nil {
			return "", "", false
		}
		var defs []string
		i := s.rest + 1
		if s.up(i) == "IF" {
			i = s.skipIf(i)
		}
		for _, part := range splitTop(stripParens(s.toks[i:]), isComma) {
			if len(part) != 1 || !isName(part[0]) {
				return "", "", false
			}
			found := false
			for _, c := range tb.Columns {
				if c.Name == part[0].Ident() {
					d := schema.Ident(c.Name) + " " + c.CQL
					if c.Kind == schema.KindStatic {
						d += " static"
					}
					defs = append(defs, d)
					found = true
				}
			}
			if !found {
				return "", "", false
			}
		}
		if len(defs) == 0 {
			return "", "", false
		}
		return "ALTER TABLE " + target + " ADD " + listOrParen(defs) + ";", NoteRecreate, true
	case "RENAME":
		pairs, ok := s.renamePairs(s.rest + 1)
		if !ok {
			return "", "", false
		}
		return "ALTER TABLE " + target + " RENAME " + pairs + ";", "", true
	case "WITH":
		return s.alterOptions(before, kw, target)
	}
	return "", "", false
}

func listOrParen(items []string) string {
	if len(items) == 1 {
		return items[0]
	}
	return "(" + strings.Join(items, ", ") + ")"
}

func stripParens(toks []cql.Token) []cql.Token {
	if len(toks) >= 2 && toks[0].IsPunct('(') && toks[len(toks)-1].IsPunct(')') {
		return toks[1 : len(toks)-1]
	}
	return toks
}

// columnDefs returns the token groups of the column definitions after ADD.
func (s *stmt) columnDefs(i int) [][]cql.Token {
	i = s.skipIf(i)
	var out [][]cql.Token
	for _, d := range splitTop(stripParens(s.toks[i:]), isComma) {
		if len(d) >= 2 && isName(d[0]) {
			out = append(out, d)
		}
	}
	return out
}

func tableOf(snap *schema.Snapshot, ks, name string) *schema.Table {
	if k := snap.Keyspace(ks); k != nil {
		return k.Table(name)
	}
	return nil
}

// alterOptions restores the previous value of exactly the options the statement sets.
func (s *stmt) alterOptions(before *schema.Snapshot, kw, target string) (string, string, bool) {
	if before == nil {
		return "", "", false
	}
	var prev []schema.Option
	if s.info.Kind == "view" {
		if k := before.Keyspace(s.info.Keyspace); k != nil {
			if v := k.View(s.info.Name); v != nil {
				prev = v.Options
			}
		}
	} else if tb := tableOf(before, s.info.Keyspace, s.info.Name); tb != nil {
		prev = tb.Options
	}
	if prev == nil {
		return "", "", false
	}
	var parts []string
	for _, opt := range splitTop(s.toks[s.rest+1:], isAnd) {
		if len(opt) < 3 || !isName(opt[0]) || !opt[1].IsPunct('=') {
			continue
		}
		name := opt[0].Ident()
		for _, o := range prev {
			if o.Name == name {
				parts = append(parts, name+" = "+o.Value)
				break
			}
		}
	}
	if len(parts) == 0 {
		return "", "", false
	}
	return fmt.Sprintf("ALTER %s %s WITH %s;", kw, target, strings.Join(parts, " AND ")), "", true
}
