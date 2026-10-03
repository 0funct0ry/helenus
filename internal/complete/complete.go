// Package complete is the completion engine shared by shell tab-completion and the
// web editor (SPEC §10). It works on the lexer's token stream, not a full grammar.
package complete

import (
	"context"
	"sort"
	"strings"

	"github.com/0funct0ry/helenus/internal/cql"
	"github.com/0funct0ry/helenus/internal/schema"
)

// Item kinds.
const (
	KindKeyword  = "keyword"
	KindKeyspace = "keyspace"
	KindTable    = "table"
	KindView     = "view"
	KindColumn   = "column"
	KindFunction = "function"
	KindType     = "type"
	KindCommand  = "command"
)

// Item is one completion candidate.
type Item struct {
	Label string `json:"label"`
	Kind  string `json:"kind"`
	// Detail is the column type, key summary or short description.
	Detail string `json:"detail,omitempty"`
	// Insert is the text that replaces the word being typed, with identifier quoting applied.
	Insert string `json:"insert"`
	// Key, Position and Order mark key columns: partition, clustering or static.
	Key      string `json:"key,omitempty"`
	Position int    `json:"position,omitempty"`
	Order    string `json:"order,omitempty"`

	match string
}

// Result is the candidate list and the byte offset where Insert text starts replacing the text.
type Result struct {
	From  int    `json:"from"`
	Items []Item `json:"items"`
}

// Complete returns the candidates at byte offset cursor of text. snap may be nil, in which case only
// keywords, functions and types are offered. currentKS is the keyspace unqualified names resolve in.
func Complete(ctx context.Context, snap *schema.Snapshot, currentKS, text string, cursor int) Result {
	return CompleteWith(ctx, snap, currentKS, text, cursor, nil)
}

// CompleteWith is Complete plus the shell alias names offered after ':'.
func CompleteWith(_ context.Context, snap *schema.Snapshot, currentKS, text string, cursor int, aliases []string) Result {
	if cursor < 0 {
		cursor = 0
	}
	if cursor > len(text) {
		cursor = len(text)
	}
	for cursor > 0 && cursor < len(text) && text[cursor]&0xC0 == 0x80 { // inside a UTF-8 sequence
		cursor--
	}
	empty := Result{From: cursor, Items: []Item{}}
	if inLiteralOrComment(text[:cursor]) {
		return empty
	}

	var all []cql.Token
	var stmt *cql.Statement
	stmts := cql.Split(text)
	for i := range stmts {
		s := stmts[i]
		if inStatement(text, s, cursor) {
			stmt = &stmts[i]
		}
	}
	if stmt != nil {
		all = cql.Tokenize(text[stmt.Start:stmt.End])
		for i := range all {
			all[i].Start += stmt.Start
			all[i].End += stmt.Start
		}
	}

	// Dot commands (.use) and alias invocations (:recent).
	if stmt != nil && len(all) > 0 && (all[0].IsPunct('.') || all[0].IsPunct(':')) {
		if !strings.ContainsAny(text[all[0].Start:cursor], " \t\n") {
			return slashResult(text, all[0].Start, cursor, aliases)
		}
		if all[0].IsPunct(':') || len(all) < 2 || !isMetaWord(all[1]) {
			return empty
		}
		all = all[1:] // complete the arguments as for the bare command word
	}

	// Split the tokens at the cursor, separating the word being typed.
	idx := 0
	for idx < len(all) && all[idx].End <= cursor && !(all[idx].End == cursor && typing(all[idx], cursor)) {
		idx++
	}
	from, prefix, quoted := cursor, "", false
	var rest []cql.Token
	if idx < len(all) {
		t := all[idx]
		switch {
		case t.Start < cursor && cursor <= t.End && typing(t, cursor):
			from, prefix = t.Start, text[t.Start:cursor]
			rest = all[idx+1:]
		case t.Start < cursor:
			return empty // inside a string or number
		default:
			rest = all[idx:]
		}
	}
	before := all[:idx]
	if strings.HasPrefix(prefix, `"`) {
		prefix, quoted = strings.ReplaceAll(strings.TrimPrefix(prefix, `"`), `""`, `"`), true
	}

	s := analyze(before, rest)
	items := build(snap, currentKS, s)
	return Result{From: from, Items: filter(items, prefix, quoted)}
}

// inStatement reports whether a cursor belongs to s: inside it, or in the whitespace after a
// statement that is still open (no semicolon yet, or a meta-command on the same line).
func inStatement(text string, s cql.Statement, cursor int) bool {
	switch {
	case cursor < s.Start:
		return false
	case s.Meta:
		return cursor <= s.End || !strings.Contains(text[s.End:cursor], "\n")
	case cursor < s.End:
		return true
	case strings.HasSuffix(s.Text, ";") && s.Complete:
		return false
	}
	return true
}

// typing reports whether t, ending at or containing the cursor, is the word being typed.
func typing(t cql.Token, cursor int) bool {
	switch t.Kind {
	case cql.TokWord:
		return true
	case cql.TokQIdent:
		return t.Open || cursor < t.End
	}
	return false
}

func slashResult(text string, from, cursor int, aliases []string) Result {
	prefix := text[from:cursor]
	var items []Item
	if prefix[0] == ':' {
		for _, a := range aliases {
			label := ":" + a
			items = append(items, Item{Label: label, Kind: KindCommand, Detail: "alias", Insert: label, match: label})
		}
		return Result{From: from, Items: filter(items, prefix, false)}
	}
	for _, c := range metaCommands {
		label := "." + c.name
		items = append(items, Item{Label: label, Kind: KindCommand, Detail: c.detail, Insert: label, match: label})
	}
	return Result{From: from, Items: filter(items, prefix, false)}
}

// inLiteralOrComment reports whether the end of s lies inside a string literal or a comment.
func inLiteralOrComment(s string) bool {
	i := 0
	for i < len(s) {
		c := s[i]
		switch {
		case c == '-' && i+1 < len(s) && s[i+1] == '-', c == '/' && i+1 < len(s) && s[i+1] == '/':
			j := strings.IndexByte(s[i:], '\n')
			if j < 0 {
				return true
			}
			i += j
		case c == '/' && i+1 < len(s) && s[i+1] == '*':
			j := strings.Index(s[i+2:], "*/")
			if j < 0 {
				return true
			}
			i += 2 + j + 2
		case c == '\'':
			j := i + 1
			for j < len(s) {
				if s[j] == '\'' {
					if j+1 < len(s) && s[j+1] == '\'' {
						j += 2
						continue
					}
					break
				}
				j++
			}
			if j >= len(s) {
				return true
			}
			i = j + 1
		case c == '"':
			// Quoted identifiers are completed, so just skip over closed ones.
			j := i + 1
			for j < len(s) {
				if s[j] == '"' {
					if j+1 < len(s) && s[j+1] == '"' {
						j += 2
						continue
					}
					break
				}
				j++
			}
			if j >= len(s) {
				return false
			}
			i = j + 1
		case c == '$' && i+1 < len(s) && s[i+1] == '$':
			j := strings.Index(s[i+2:], "$$")
			if j < 0 {
				return true
			}
			i += 2 + j + 2
		default:
			i++
		}
	}
	return false
}

// filter keeps the items whose name starts with prefix. Matching ignores case, except after an
// opening quote, where the identifier's exact case is being typed.
func filter(items []Item, prefix string, quoted bool) []Item {
	out := make([]Item, 0, len(items))
	seen := map[string]bool{}
	p := strings.ToLower(prefix)
	for _, it := range items {
		m := strings.ToLower(it.match)
		if quoted {
			m, p = it.match, prefix
		}
		if !strings.HasPrefix(m, p) {
			continue
		}
		key := it.Kind + "\x00" + it.Label
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, it)
	}
	return out
}

// build turns a spec into candidates in display order.
func build(snap *schema.Snapshot, currentKS string, s spec) []Item {
	var items []Item
	ks := func(name string) string {
		if name == "" {
			return currentKS
		}
		return name
	}
	if s.cols != colNone || len(s.defined) > 0 {
		items = append(items, columnItems(snap, ks(s.tbl.ks), s)...)
	}
	if s.kinds != 0 {
		items = append(items, targetItems(snap, currentKS, s)...)
	}
	if s.types {
		items = append(items, typeItems(snap, ks(s.tbl.ks))...)
	}
	if s.funcs {
		items = append(items, funcItems(s.funcSet)...)
	}
	for _, l := range s.lits {
		items = append(items, Item{Label: l, Kind: KindKeyword, Detail: s.litKind, Insert: l, match: strings.Trim(l, "'")})
	}
	for _, k := range s.kw {
		items = append(items, Item{Label: k, Kind: KindKeyword, Insert: k, match: k})
	}
	return items
}

func lookupTable(snap *schema.Snapshot, ks, name string) (cols []schema.Column, ok bool) {
	if snap == nil || name == "" {
		return nil, false
	}
	k := snap.Keyspace(ks)
	if k == nil {
		return nil, false
	}
	if t := k.Table(name); t != nil {
		return t.Columns, true
	}
	if v := k.View(name); v != nil {
		return v.Columns, true
	}
	return nil, false
}

func columnItems(snap *schema.Snapshot, ks string, s spec) []Item {
	var items []Item
	for _, d := range s.defined {
		items = append(items, Item{Label: d.name, Kind: KindColumn, Detail: d.typ, Insert: cql.QuoteIdent(d.name), match: d.name})
	}
	if s.cols == colNone || !s.tbl.set {
		return items
	}
	cols, ok := lookupTable(snap, ks, s.tbl.name)
	if !ok {
		return items
	}
	ordered := orderColumns(cols, s.cols)
	for _, c := range ordered {
		it := Item{Label: c.Name, Kind: KindColumn, Detail: c.CQL, Insert: cql.QuoteIdent(c.Name), match: c.Name}
		if c.Kind != schema.KindRegular {
			it.Key, it.Position, it.Order = c.Kind, c.Position, c.Order
		}
		items = append(items, it)
	}
	return items
}

func orderColumns(cols []schema.Column, mode colMode) []schema.Column {
	var pk, ck, rest []schema.Column
	for _, c := range cols {
		switch c.Kind {
		case schema.KindPartition:
			pk = append(pk, c)
		case schema.KindClustering:
			ck = append(ck, c)
		default:
			rest = append(rest, c)
		}
	}
	byPos := func(l []schema.Column) {
		sort.SliceStable(l, func(i, j int) bool { return l[i].Position < l[j].Position })
	}
	byPos(pk)
	byPos(ck)
	switch mode {
	case colPK:
		return append(append(pk, ck...), rest...)
	case colClustering:
		return ck
	case colNonKey:
		return rest
	}
	return cols
}

func targetItems(snap *schema.Snapshot, currentKS string, s spec) []Item {
	var items []Item
	if snap == nil {
		return nil
	}
	ksNames := func() []string {
		if s.hasQual {
			return []string{s.qual}
		}
		return []string{currentKS}
	}
	if !s.hasQual {
		for _, k := range snap.Keyspaces {
			d := "keyspace"
			if k.System {
				d = "system keyspace"
			}
			items = append(items, Item{Label: k.Name, Kind: KindKeyspace, Detail: d, Insert: cql.QuoteIdent(k.Name), match: k.Name})
		}
	}
	for _, name := range ksNames() {
		k := snap.Keyspace(name)
		if k == nil {
			continue
		}
		if s.kinds&tkTable != 0 {
			for _, t := range k.Tables {
				items = append(items, Item{Label: t.Name, Kind: KindTable, Detail: keySummary(t.Columns), Insert: cql.QuoteIdent(t.Name), match: t.Name})
			}
		}
		if s.kinds&tkView != 0 {
			for _, v := range k.Views {
				items = append(items, Item{Label: v.Name, Kind: KindView, Detail: "view of " + v.BaseTable, Insert: cql.QuoteIdent(v.Name), match: v.Name})
			}
		}
		if s.kinds&tkType != 0 {
			for _, u := range k.Types {
				items = append(items, Item{Label: u.Name, Kind: KindType, Detail: "user type", Insert: cql.QuoteIdent(u.Name), match: u.Name})
			}
		}
		if s.kinds&tkIndex != 0 {
			for _, t := range k.Tables {
				for _, ix := range t.Indexes {
					items = append(items, Item{Label: ix.Name, Kind: KindTable, Detail: "index on " + t.Name, Insert: cql.QuoteIdent(ix.Name), match: ix.Name})
				}
			}
		}
		if s.kinds&tkFunction != 0 {
			for _, f := range k.Functions {
				items = append(items, Item{Label: f.Name, Kind: KindFunction, Detail: f.ReturnType, Insert: cql.QuoteIdent(f.Name), match: f.Name})
			}
		}
		if s.kinds&tkAggregate != 0 {
			for _, f := range k.Aggregates {
				items = append(items, Item{Label: f.Name, Kind: KindFunction, Detail: f.ReturnType, Insert: cql.QuoteIdent(f.Name), match: f.Name})
			}
		}
	}
	return items
}

// keySummary renders a table's primary key, for example `PK (a, b) · CK (c)`.
func keySummary(cols []schema.Column) string {
	var pk, ck []string
	for _, c := range orderColumns(cols, colPK) {
		switch c.Kind {
		case schema.KindPartition:
			pk = append(pk, c.Name)
		case schema.KindClustering:
			ck = append(ck, c.Name)
		}
	}
	out := "PK (" + strings.Join(pk, ", ") + ")"
	if len(ck) > 0 {
		out += " · CK (" + strings.Join(ck, ", ") + ")"
	}
	return out
}

func typeItems(snap *schema.Snapshot, ks string) []Item {
	var items []Item
	for _, t := range nativeTypes {
		items = append(items, Item{Label: t, Kind: KindType, Detail: "native type", Insert: t, match: t})
	}
	if snap != nil {
		if k := snap.Keyspace(ks); k != nil {
			for _, u := range k.Types {
				items = append(items, Item{Label: u.Name, Kind: KindType, Detail: "user type", Insert: cql.QuoteIdent(u.Name), match: u.Name})
			}
		}
	}
	for _, t := range collectionTypes {
		items = append(items, Item{Label: t, Kind: KindType, Detail: "type constructor", Insert: t, match: t})
	}
	return items
}

func funcItems(only []string) []Item {
	var items []Item
	for _, f := range builtinFunctions {
		if len(only) > 0 && !contains(only, f.name) {
			continue
		}
		items = append(items, Item{Label: f.name + "()", Kind: KindFunction, Detail: f.detail, Insert: f.name + "()", match: f.name})
	}
	return items
}

func contains(l []string, s string) bool {
	for _, x := range l {
		if x == s {
			return true
		}
	}
	return false
}

// isMetaWord reports whether t names a dot command.
func isMetaWord(t cql.Token) bool {
	if t.Kind != cql.TokWord {
		return false
	}
	for _, m := range metaCommands {
		if strings.EqualFold(m.name, t.Text) {
			return true
		}
	}
	return false
}
