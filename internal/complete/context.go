package complete

import (
	"strings"

	"github.com/0funct0ry/helenus/internal/cql"
)

// colMode says which columns of the table in scope to offer and in what order.
type colMode int

const (
	colNone       colMode = iota
	colPK                 // partition keys, clustering keys in order, then the rest (WHERE, INSERT)
	colClustering         // clustering keys in order (ORDER BY)
	colAll                // schema order
	colNonKey             // regular and static columns (UPDATE SET)
)

// target kinds, a bit set.
const (
	tkKeyspace = 1 << iota
	tkTable
	tkView
	tkType
	tkIndex
	tkFunction
	tkAggregate
)

// tref names a table or other object found in the statement. An empty ks means the current keyspace.
type tref struct {
	ks, name string
	set      bool
}

// spec is what the clause detector decided belongs at the cursor.
type spec struct {
	kw      []string // keywords, possibly multi-word
	lits    []string // literal values such as consistency levels
	litKind string   // detail shown for lits
	kinds   int      // target kinds
	qual    string   // keyspace qualifier in `ks.`
	hasQual bool
	tbl     tref
	cols    colMode
	defined []definedCol // columns declared by the CREATE statement being typed
	funcs   bool
	funcSet []string // restrict functions to these names when set
	types   bool
	meta    bool // statement start: meta-command words
}

type definedCol struct{ name, typ string }

func up(t cql.Token) string { return t.Upper() }

func isWord(t cql.Token, w string) bool { return t.Kind == cql.TokWord && strings.EqualFold(t.Text, w) }

func isNameTok(t cql.Token) bool { return t.Kind == cql.TokWord || t.Kind == cql.TokQIdent }

func lastTok(b []cql.Token) (cql.Token, bool) {
	if len(b) == 0 {
		return cql.Token{}, false
	}
	return b[len(b)-1], true
}

// indexWord returns the index of the first top-level occurrence of w in b, or -1.
func indexWord(b []cql.Token, w string) int {
	depth := 0
	for i, t := range b {
		switch {
		case t.IsPunct('('):
			depth++
		case t.IsPunct(')'):
			depth--
		case depth == 0 && isWord(t, w):
			return i
		}
	}
	return -1
}

// lastTop returns the index of the last top-level token of b that is a word in set, or -1.
func lastTop(b []cql.Token, set ...string) int {
	depth := 0
	for i := len(b) - 1; i >= 0; i-- {
		t := b[i]
		switch {
		case t.IsPunct(')'):
			depth++
		case t.IsPunct('('):
			if depth > 0 { // an unmatched '(' is the one the cursor is inside; look past it
				depth--
			}
		case depth == 0 && t.Kind == cql.TokWord:
			u := up(t)
			for _, s := range set {
				if u == s {
					return i
				}
			}
		}
	}
	return -1
}

// open returns the index of the innermost unclosed '(' in b, or -1.
func open(b []cql.Token) int {
	depth := 0
	for i := len(b) - 1; i >= 0; i-- {
		switch {
		case b[i].IsPunct(')'):
			depth++
		case b[i].IsPunct('('):
			if depth == 0 {
				return i
			}
			depth--
		}
	}
	return -1
}

// angle returns how many '<' are unclosed in b.
func angle(b []cql.Token) int {
	n := 0
	for _, t := range b {
		if t.IsPunct('<') {
			n++
		} else if t.IsPunct('>') && n > 0 {
			n--
		}
	}
	return n
}

// splitTop splits b at top-level commas (parentheses and angle brackets nest).
func splitTop(b []cql.Token) [][]cql.Token {
	var out [][]cql.Token
	depth, start := 0, 0
	for i, t := range b {
		switch {
		case t.IsPunct('('), t.IsPunct('<'), t.IsPunct('{'), t.IsPunct('['):
			depth++
		case t.IsPunct(')'), t.IsPunct('>'), t.IsPunct('}'), t.IsPunct(']'):
			depth--
		case t.IsPunct(',') && depth == 0:
			out = append(out, b[start:i])
			start = i + 1
		}
	}
	return append(out, b[start:])
}

// target is the result of parsing `[ks.]name` at some position.
type target struct {
	present    bool // a name token starts here
	pendingDot bool // `ks.` typed, name still to come
	ks, name   string
	end        int // index after the parsed tokens
}

func parseTarget(b []cql.Token, i int) target {
	if i >= len(b) || !isNameTok(b[i]) {
		return target{end: i}
	}
	t := target{present: true, name: b[i].Ident(), end: i + 1}
	if i+1 < len(b) && b[i+1].IsPunct('.') {
		t.ks = t.name
		if i+2 < len(b) && isNameTok(b[i+2]) {
			t.name, t.end = b[i+2].Ident(), i+3
		} else {
			t.name, t.pendingDot, t.end = "", true, i+2
		}
	}
	return t
}

func (t target) ref() tref { return tref{ks: t.ks, name: t.name, set: t.present && !t.pendingDot} }

// findTarget locates the target following the first top-level word w in toks.
func findTarget(toks []cql.Token, w string) tref {
	if i := indexWord(toks, w); i >= 0 {
		return parseTarget(toks, i+1).ref()
	}
	return tref{}
}

// targetSpec offers objects of the given kinds at a target position.
func targetSpec(t target, kinds int, kw ...string) spec {
	s := spec{kinds: kinds, kw: kw}
	if t.pendingDot {
		s.qual, s.hasQual, s.kw = t.ks, true, nil
	}
	return s
}

// analyze decides what belongs at the cursor. b holds the statement's tokens before the cursor
// (excluding the word being typed) and a the tokens after it.
func analyze(b, a []cql.Token) spec {
	if len(b) == 0 {
		return spec{kw: startKeywords, meta: true}
	}
	switch up(b[0]) {
	case "BEGIN":
		return batchSpec(b, a)
	case "SELECT":
		return selectSpec(b, a)
	case "INSERT":
		return insertSpec(b, a)
	case "UPDATE":
		return updateSpec(b, a)
	case "DELETE":
		return deleteSpec(b, a)
	case "USE":
		if len(b) == 1 {
			return spec{kinds: tkKeyspace}
		}
	case "TRUNCATE":
		i := 1
		if len(b) > 1 && isWord(b[1], "TABLE") {
			i = 2
		}
		if len(b) == 1 {
			return spec{kw: []string{"TABLE"}, kinds: tkTable}
		}
		return objectSpec(b, i, tkTable, nil)
	case "DESCRIBE", "DESC":
		return describeSpec(b)
	case "DROP":
		return dropSpec(b)
	case "CREATE":
		return createSpec(b, a)
	case "ALTER":
		return alterSpec(b, a)
	case "CONSISTENCY":
		if len(b) == 1 {
			return spec{lits: consistencyLevels, litKind: "consistency level"}
		}
	case "SERIAL":
		switch len(b) {
		case 1:
			return spec{kw: []string{"CONSISTENCY"}}
		case 2:
			if isWord(b[1], "CONSISTENCY") {
				return spec{lits: serialLevels, litKind: "serial consistency level"}
			}
		}
	case "SHOW":
		if len(b) == 1 {
			return spec{kw: []string{"VERSION", "HOST"}}
		}
	case "FORMAT":
		if len(b) == 1 {
			return spec{lits: []string{"table", "expanded", "raw"}, litKind: "output format"}
		}
	case "EXPAND", "TRACING", "TIMING":
		if len(b) == 1 {
			return spec{kw: []string{"ON", "OFF"}}
		}
	case "PAGING":
		if len(b) == 1 {
			return spec{kw: []string{"ON", "OFF"}}
		}
	case "HELP":
		if len(b) == 1 {
			var l []string
			for _, m := range metaCommands {
				l = append(l, strings.ToLower(m.name))
			}
			return spec{lits: l, litKind: "command"}
		}
	}
	return spec{}
}

// batchSpec handles BEGIN [UNLOGGED|COUNTER] BATCH [USING TIMESTAMP n] stmt; ... APPLY BATCH.
func batchSpec(b, a []cql.Token) spec {
	i := 1
	if i < len(b) && (isWord(b[i], "UNLOGGED") || isWord(b[i], "COUNTER")) {
		i++
	}
	if i >= len(b) {
		if i == 1 {
			return spec{kw: []string{"UNLOGGED", "COUNTER", "BATCH"}}
		}
		return spec{kw: []string{"BATCH"}}
	}
	if !isWord(b[i], "BATCH") {
		return spec{}
	}
	i++
	body := b[i:]
	inBody := false
	if n := lastPunct(body, ';'); n >= 0 {
		body, inBody = body[n+1:], true
	}
	if !inBody && len(body) > 0 && isWord(body[0], "USING") {
		kw, done := usingNext(body[1:], true)
		if done {
			return spec{kw: append(kw, "INSERT", "UPDATE", "DELETE")}
		}
		return spec{kw: kw}
	}
	stmtKW := []string{"INSERT", "UPDATE", "DELETE", "APPLY BATCH"}
	if len(body) == 0 {
		if !inBody {
			return spec{kw: append([]string{"USING TIMESTAMP"}, stmtKW...)}
		}
		return spec{kw: stmtKW}
	}
	if isWord(body[0], "APPLY") {
		if len(body) == 1 {
			return spec{kw: []string{"BATCH"}}
		}
		return spec{}
	}
	if n := firstPunct(a, ';'); n >= 0 {
		a = a[:n]
	}
	return analyze(body, a)
}

func lastPunct(b []cql.Token, p byte) int {
	for i := len(b) - 1; i >= 0; i-- {
		if b[i].IsPunct(p) {
			return i
		}
	}
	return -1
}

func firstPunct(b []cql.Token, p byte) int {
	for i, t := range b {
		if t.IsPunct(p) {
			return i
		}
	}
	return -1
}

// usingNext handles the tokens after USING (TTL and TIMESTAMP joined by AND). done reports that a
// complete option was just given, so the caller may add the keywords that follow USING.
func usingNext(w []cql.Token, ttl bool) (kw []string, done bool) {
	opts := []string{"TIMESTAMP"}
	if ttl {
		opts = []string{"TTL", "TIMESTAMP"}
	}
	t, ok := lastTok(w)
	switch {
	case !ok:
		return opts, false
	case isWord(t, "TTL"), isWord(t, "TIMESTAMP"):
		return nil, false
	case isWord(t, "AND"):
		return opts, false
	}
	return []string{"AND"}, true
}

// whereSpec handles the tokens after WHERE (or IF). tail lists the keywords offered once a condition is complete.
func whereSpec(w []cql.Token, mode colMode, tail []string) spec {
	if i := open(w); i >= 0 {
		if i > 0 && isWord(w[i-1], "IN") {
			return spec{funcs: true}
		}
		if i > 0 && isWord(w[i-1], "token") {
			return spec{cols: colPK}
		}
		return spec{cols: mode, funcs: true}
	}
	t, ok := lastTok(w)
	if !ok || isWord(t, "AND") {
		return spec{cols: mode, funcs: true, funcSet: []string{"token"}}
	}
	if t.Kind == cql.TokPunct && strings.ContainsRune("=<>!+-", rune(t.Text[0])) {
		return spec{funcs: true}
	}
	if isWord(t, "IN") || isWord(t, "KEY") || isWord(t, "CONTAINS") || isWord(t, "LIKE") || isWord(t, "NOT") || isWord(t, "IS") {
		switch up(t) {
		case "IS":
			return spec{kw: []string{"NOT NULL"}}
		case "NOT":
			return spec{kw: []string{"NULL"}}
		case "CONTAINS":
			return spec{kw: []string{"KEY"}, funcs: true}
		}
		return spec{funcs: true}
	}
	prevAnd := len(w) == 1 || isWord(w[len(w)-2], "AND")
	if isNameTok(t) && prevAnd {
		return spec{kw: []string{"IN", "CONTAINS", "CONTAINS KEY", "LIKE", "IS NOT NULL"}}
	}
	return spec{kw: append([]string{"AND"}, tail...)}
}

var selectTail = []string{"GROUP BY", "ORDER BY", "PER PARTITION LIMIT", "LIMIT", "ALLOW FILTERING"}

func selectSpec(b, a []cql.Token) spec {
	all := append(append([]cql.Token{}, b...), a...)
	tbl := findTarget(all, "FROM")
	from := indexWord(b, "FROM")
	if from < 0 {
		if open(b) >= 0 {
			return spec{cols: colAll, funcs: true, tbl: tbl}
		}
		t, _ := lastTok(b)
		switch {
		case len(b) == 1:
			return spec{cols: colAll, funcs: true, tbl: tbl, kw: []string{"JSON", "DISTINCT"}}
		case t.IsPunct(','), isWord(t, "DISTINCT"), isWord(t, "JSON"), t.Kind == cql.TokPunct && strings.ContainsRune("+-/%", rune(t.Text[0])):
			return spec{cols: colAll, funcs: true, tbl: tbl}
		case isWord(t, "AS"):
			return spec{}
		}
		return spec{kw: []string{"FROM", "AS"}, tbl: tbl}
	}
	t := parseTarget(b, from+1)
	if !t.present || t.pendingDot {
		return targetSpec(t, tkTable|tkView)
	}
	past := b[t.end:]
	tbl = t.ref()
	k := lastTop(past, "WHERE", "GROUP", "ORDER", "PER", "LIMIT", "ALLOW")
	if k < 0 {
		return spec{kw: append([]string{"WHERE"}, selectTail...), tbl: tbl}
	}
	rest := past[k+1:]
	s := spec{tbl: tbl}
	switch up(past[k]) {
	case "WHERE":
		s = whereSpec(rest, colPK, selectTail)
	case "GROUP", "ORDER":
		by := indexWord(rest, "BY")
		if by < 0 {
			s.kw = []string{"BY"}
			break
		}
		mode := colClustering
		if up(past[k]) == "GROUP" {
			mode = colPK
		}
		rest = rest[by+1:]
		if t, ok := lastTok(rest); !ok || t.IsPunct(',') {
			s.cols = mode
		} else if up(past[k]) == "ORDER" {
			s.kw = []string{"ASC", "DESC", "LIMIT", "ALLOW FILTERING"}
		} else {
			s.kw = []string{"ORDER BY", "PER PARTITION LIMIT", "LIMIT", "ALLOW FILTERING"}
		}
	case "PER":
		s.kw = followers["PER"]
		if len(rest) > 0 {
			s.kw = followers["PARTITION"]
		}
		if len(rest) > 1 {
			s.kw = nil
		}
	case "LIMIT":
		if len(rest) > 0 {
			s.kw = []string{"ALLOW FILTERING"}
		}
	case "ALLOW":
		if len(rest) == 0 {
			s.kw = []string{"FILTERING"}
		}
	}
	s.tbl = tbl
	return s
}

func insertSpec(b, a []cql.Token) spec {
	if len(b) == 1 {
		return spec{kw: []string{"INTO"}}
	}
	t := parseTarget(b, 2)
	if !t.present || t.pendingDot {
		return targetSpec(t, tkTable)
	}
	tbl := t.ref()
	past := b[t.end:]
	if len(past) == 0 {
		return spec{kw: []string{"JSON"}, tbl: tbl}
	}
	v := indexWord(past, "VALUES")
	if v < 0 {
		if open(past) >= 0 {
			return spec{cols: colPK, tbl: tbl}
		}
		if len(past) > 0 && past[0].IsPunct('(') {
			return spec{kw: []string{"VALUES"}, tbl: tbl}
		}
		return spec{tbl: tbl}
	}
	rest := past[v+1:]
	if open(rest) >= 0 {
		return spec{funcs: true, tbl: tbl}
	}
	if len(rest) == 0 {
		return spec{tbl: tbl}
	}
	k := lastTop(rest, "IF", "USING")
	if k < 0 {
		return spec{kw: []string{"IF NOT EXISTS", "USING TTL", "USING TIMESTAMP"}, tbl: tbl}
	}
	if up(rest[k]) == "IF" {
		switch len(rest) - k {
		case 1:
			return spec{kw: []string{"NOT EXISTS"}, tbl: tbl}
		case 2:
			return spec{kw: []string{"EXISTS"}, tbl: tbl}
		}
		return spec{kw: []string{"USING TTL", "USING TIMESTAMP"}, tbl: tbl}
	}
	kw, done := usingNext(rest[k+1:], true)
	if done {
		kw = append(kw, "IF NOT EXISTS")
	}
	return spec{kw: kw, tbl: tbl}
}

func updateSpec(b, a []cql.Token) spec {
	t := parseTarget(b, 1)
	if !t.present || t.pendingDot {
		return targetSpec(t, tkTable)
	}
	tbl := t.ref()
	past := b[t.end:]
	k := lastTop(past, "USING", "SET", "WHERE", "IF")
	if k < 0 {
		return spec{kw: []string{"USING TTL", "USING TIMESTAMP", "SET"}, tbl: tbl}
	}
	rest := past[k+1:]
	s := spec{tbl: tbl}
	switch up(past[k]) {
	case "USING":
		kw, done := usingNext(rest, true)
		if done {
			kw = append(kw, "SET")
		}
		s.kw = kw
	case "SET":
		if i := open(rest); i >= 0 {
			s.funcs, s.cols = true, colAll
			break
		}
		seg := splitTop(rest)
		cur := seg[len(seg)-1]
		eq := firstPunct(cur, '=')
		switch {
		case len(cur) == 0:
			s.cols = colNonKey
		case eq < 0:
		case eq == len(cur)-1, cur[len(cur)-1].Kind == cql.TokPunct && strings.ContainsRune("+-", rune(cur[len(cur)-1].Text[0])):
			s.funcs = true
		default:
			s.kw = []string{"WHERE"}
		}
	case "WHERE":
		s = whereSpec(rest, colPK, []string{"IF", "IF EXISTS"})
		s.tbl = tbl
	case "IF":
		s = ifSpec(rest)
		s.tbl = tbl
	}
	return s
}

// ifSpec handles the condition list after IF in UPDATE and DELETE.
func ifSpec(w []cql.Token) spec {
	t, ok := lastTok(w)
	if !ok || isWord(t, "AND") {
		return spec{cols: colAll, kw: []string{"EXISTS"}}
	}
	return whereSpec(w, colAll, nil)
}

func deleteSpec(b, a []cql.Token) spec {
	all := append(append([]cql.Token{}, b...), a...)
	tbl := findTarget(all, "FROM")
	from := indexWord(b, "FROM")
	if from < 0 {
		if t, _ := lastTok(b); len(b) > 1 && !t.IsPunct(',') {
			return spec{kw: []string{"FROM"}, tbl: tbl}
		}
		return spec{cols: colAll, kw: []string{"FROM"}, tbl: tbl}
	}
	t := parseTarget(b, from+1)
	if !t.present || t.pendingDot {
		return targetSpec(t, tkTable)
	}
	tbl = t.ref()
	past := b[t.end:]
	k := lastTop(past, "USING", "WHERE", "IF")
	if k < 0 {
		return spec{kw: []string{"USING TIMESTAMP", "WHERE"}, tbl: tbl}
	}
	rest := past[k+1:]
	s := spec{tbl: tbl}
	switch up(past[k]) {
	case "USING":
		kw, done := usingNext(rest, false)
		if done {
			kw = []string{"WHERE"}
		}
		s.kw = kw
	case "WHERE":
		s = whereSpec(rest, colPK, []string{"IF", "IF EXISTS"})
		s.tbl = tbl
	case "IF":
		s = ifSpec(rest)
		s.tbl = tbl
	}
	return s
}

func describeSpec(b []cql.Token) spec {
	if len(b) == 1 {
		return spec{kw: describeTargets}
	}
	switch up(b[1]) {
	case "KEYSPACE":
		if len(b) == 2 {
			return spec{kinds: tkKeyspace}
		}
	case "TABLE":
		return objectSpec(b, 2, tkTable, nil)
	case "TYPE":
		return objectSpec(b, 2, tkType, nil)
	case "INDEX":
		return objectSpec(b, 2, tkIndex, nil)
	case "FUNCTION":
		return objectSpec(b, 2, tkFunction, nil)
	case "AGGREGATE":
		return objectSpec(b, 2, tkAggregate, nil)
	case "MATERIALIZED":
		if len(b) == 2 {
			return spec{kw: []string{"VIEW"}}
		}
		return objectSpec(b, 3, tkView, nil)
	case "FULL":
		if len(b) == 2 {
			return spec{kw: []string{"SCHEMA"}}
		}
	}
	// DESCRIBE [ks.]name: a bare table, view, type or index name.
	if t := parseTarget(b, 1); t.pendingDot && t.end == len(b) {
		return targetSpec(t, tkTable|tkView|tkType|tkIndex)
	}
	return spec{}
}

// objectSpec offers objects of the given kinds at the `[ks.]name` position starting at b[i], after
// any IF [NOT] EXISTS guard (guard lists what to offer before the name).
func objectSpec(b []cql.Token, i int, kinds int, guard []string) spec {
	j := skipGuard(b, i)
	if j < 0 {
		return spec{kw: guardRest(b, guard != nil)}
	}
	t := parseTarget(b, j)
	if !t.present || t.pendingDot {
		return targetSpec(t, kinds, guard...)
	}
	return spec{}
}

// guardRest completes a half-typed IF [NOT] EXISTS.
func guardRest(b []cql.Token, drop bool) []string {
	if drop || isWord(b[len(b)-1], "NOT") {
		return []string{"EXISTS"}
	}
	return []string{"NOT EXISTS"}
}

func dropSpec(b []cql.Token) spec {
	if len(b) == 1 {
		return spec{kw: []string{"TABLE", "KEYSPACE", "TYPE", "INDEX", "MATERIALIZED VIEW", "FUNCTION", "AGGREGATE", "ROLE", "USER", "TRIGGER"}}
	}
	switch up(b[1]) {
	case "TABLE", "COLUMNFAMILY":
		return objectSpec(b, 2, tkTable, ifExists)
	case "KEYSPACE":
		return objectSpec(b, 2, tkKeyspace, ifExists)
	case "TYPE":
		return objectSpec(b, 2, tkType, ifExists)
	case "INDEX":
		return objectSpec(b, 2, tkIndex, ifExists)
	case "FUNCTION":
		return objectSpec(b, 2, tkFunction, ifExists)
	case "AGGREGATE":
		return objectSpec(b, 2, tkAggregate, ifExists)
	case "MATERIALIZED":
		if len(b) == 2 {
			return spec{kw: []string{"VIEW"}}
		}
		return objectSpec(b, 3, tkView, ifExists)
	}
	return spec{}
}

var createObjects = []string{"TABLE", "KEYSPACE", "TYPE", "INDEX", "CUSTOM INDEX", "MATERIALIZED VIEW", "FUNCTION", "AGGREGATE", "ROLE", "USER", "TRIGGER"}

func createSpec(b, a []cql.Token) spec {
	if len(b) == 1 {
		return spec{kw: createObjects}
	}
	switch up(b[1]) {
	case "TABLE", "COLUMNFAMILY":
		return createTable(b, 2, true)
	case "TYPE":
		return createTable(b, 2, false)
	case "KEYSPACE":
		i := skipGuard(b, 2)
		if i < 0 {
			return spec{kw: guardRest(b, false)}
		}
		t := parseTarget(b, i)
		switch {
		case !t.present && len(b) == 2:
			return spec{kw: ifNotExists}
		case !t.present || t.pendingDot:
			return spec{}
		}
		past := b[t.end:]
		if len(past) == 0 {
			return spec{kw: []string{"WITH"}}
		}
		return withSpec(past[1:], keyspaceOptions, nil)
	case "CUSTOM", "INDEX":
		return createIndex(b, a)
	case "MATERIALIZED":
		if len(b) == 2 {
			return spec{kw: []string{"VIEW"}}
		}
		if as := indexWord(b, "AS"); as >= 0 {
			if len(b) == as+1 {
				return spec{kw: []string{"SELECT"}}
			}
			return selectSpec(b[as+1:], a)
		}
		if len(b) >= 4 {
			return spec{kw: []string{"AS SELECT"}}
		}
	}
	return spec{}
}

// skipGuard returns the index after an optional IF NOT EXISTS at b[i:], or -1 when it is half typed.
func skipGuard(b []cql.Token, i int) int {
	if i < len(b) && isWord(b[i], "IF") {
		for i < len(b) && (isWord(b[i], "IF") || isWord(b[i], "NOT") || isWord(b[i], "EXISTS")) {
			i++
		}
		if i == len(b) && !isWord(b[i-1], "EXISTS") {
			return -1
		}
	}
	return i
}

// createTable handles CREATE TABLE and CREATE TYPE.
func createTable(b []cql.Token, i int, table bool) spec {
	i = skipGuard(b, i)
	if i < 0 {
		return spec{kw: guardRest(b, false)}
	}
	t := parseTarget(b, i)
	switch {
	case !t.present && i == len(b) && len(b) == 2:
		return spec{kinds: tkKeyspace, kw: ifNotExists}
	case !t.present && i == len(b):
		return spec{kinds: tkKeyspace}
	case t.pendingDot, !t.present:
		return spec{}
	}
	tbl := t.ref()
	past := b[t.end:]
	if len(past) == 0 || !past[0].IsPunct('(') {
		return spec{}
	}
	closeAt := -1
	for i := range past {
		if past[i].IsPunct(')') && open(past[:i+1]) < 0 {
			closeAt = i
			break
		}
	}
	if closeAt < 0 {
		return defSpec(past[open(past)+1:], past, table, tbl)
	}
	// Closed column list.
	rest, group := past[closeAt+1:], past[:closeAt+1]
	if len(rest) == 0 {
		if table {
			return spec{kw: []string{"WITH"}, tbl: tbl}
		}
		return spec{}
	}
	if isWord(rest[0], "WITH") {
		s := withSpec(rest[1:], tableOptions, definedCols(group))
		s.tbl = tbl
		return s
	}
	return spec{}
}

// defSpec handles the inside of a CREATE TABLE/TYPE column list; inner is the tokens after the
// innermost unclosed '(' and whole is everything from the list's opening parenthesis.
func defSpec(inner, whole []cql.Token, table bool, tbl tref) spec {
	outer := whole[0].IsPunct('(') && open(whole) == 0
	defined := definedCols(whole)
	if !outer {
		// Inside a nested group such as PRIMARY KEY ((a, b), c).
		return spec{defined: defined, tbl: tbl}
	}
	seg := splitTop(inner)
	cur := seg[len(seg)-1]
	if len(cur) > 0 && isWord(cur[0], "PRIMARY") {
		if len(cur) == 1 {
			return spec{kw: []string{"KEY"}}
		}
		return spec{tbl: tbl}
	}
	switch {
	case len(cur) == 0:
		s := spec{tbl: tbl}
		if table {
			s.kw = []string{"PRIMARY KEY"}
		}
		return s
	case len(cur) == 1:
		return spec{types: true, tbl: tbl}
	case angle(cur[1:]) > 0:
		return spec{types: true, tbl: tbl}
	}
	last := cur[len(cur)-1]
	if isWord(last, "STATIC") || isWord(last, "KEY") {
		return spec{tbl: tbl}
	}
	if table {
		return spec{kw: []string{"STATIC", "PRIMARY KEY"}, tbl: tbl}
	}
	return spec{tbl: tbl}
}

// definedCols lists the name/type pairs declared in a CREATE TABLE/TYPE column list.
func definedCols(whole []cql.Token) []definedCol {
	if len(whole) == 0 || !whole[0].IsPunct('(') {
		return nil
	}
	body := whole[1:]
	if n := len(body); n > 0 && body[n-1].IsPunct(')') && open(whole) < 0 {
		body = body[:n-1]
	}
	var out []definedCol
	for _, seg := range splitTop(body) {
		if len(seg) < 2 || !isNameTok(seg[0]) || isWord(seg[0], "PRIMARY") || seg[1].Kind == cql.TokPunct {
			continue
		}
		var typ []string
		for _, t := range seg[1:] {
			if isWord(t, "STATIC") || isWord(t, "PRIMARY") || isWord(t, "KEY") {
				break
			}
			typ = append(typ, t.Text)
		}
		out = append(out, definedCol{name: seg[0].Ident(), typ: strings.Join(typ, "")})
	}
	return out
}

// withSpec handles `WITH opt = value AND opt = value`, where w is the tokens after WITH.
func withSpec(w []cql.Token, options []string, defined []definedCol) spec {
	if i := open(w); i >= 0 {
		if i > 0 && isWord(w[i-1], "BY") {
			inner := w[i+1:]
			if t, ok := lastTok(inner); !ok || t.IsPunct(',') {
				return spec{defined: defined, cols: colClustering}
			}
			return spec{kw: []string{"ASC", "DESC"}}
		}
		return withMap(w)
	}
	if i := lastPunct(w, '{'); i >= 0 && lastPunct(w, '}') < i {
		return withMap(w)
	}
	t, ok := lastTok(w)
	switch {
	case !ok, isWord(t, "AND"):
		return spec{lits: options, litKind: "option"}
	case t.IsPunct('='):
		return spec{}
	case isWord(t, "BY"), isWord(t, "ORDER"), isWord(t, "CLUSTERING"), isWord(t, "COMPACT"):
		if isWord(t, "COMPACT") {
			return spec{kw: []string{"STORAGE"}}
		}
		if isWord(t, "CLUSTERING") {
			return spec{kw: []string{"ORDER BY"}}
		}
		if isWord(t, "ORDER") {
			return spec{kw: []string{"BY"}}
		}
		return spec{}
	}
	if len(w) >= 2 && (w[len(w)-2].IsPunct('=') || t.IsPunct('}') || t.IsPunct(')') || isWord(t, "STORAGE")) {
		return spec{kw: []string{"AND"}}
	}
	if len(w) == 1 && isNameTok(t) {
		return spec{}
	}
	return spec{kw: []string{"AND"}}
}

// withMap handles the inside of a `{ 'key': value }` option map.
func withMap(w []cql.Token) spec {
	if len(w) >= 2 && w[len(w)-1].IsPunct(':') && w[len(w)-2].Kind == cql.TokString && strings.EqualFold(strings.Trim(w[len(w)-2].Text, "'"), "class") {
		return spec{lits: replicationStrategies, litKind: "strategy"}
	}
	return spec{}
}

func createIndex(b, a []cql.Token) spec {
	i := 1
	if isWord(b[1], "CUSTOM") {
		i = 2
		if len(b) == 2 {
			return spec{kw: []string{"INDEX"}}
		}
	}
	on := indexWord(b, "ON")
	if on < 0 {
		if len(b) == i+1 {
			return spec{kw: []string{"ON", "IF NOT EXISTS"}}
		}
		if isWord(b[len(b)-1], "IF") {
			return spec{kw: []string{"NOT EXISTS"}}
		}
		if isWord(b[len(b)-1], "NOT") {
			return spec{kw: []string{"EXISTS"}}
		}
		return spec{kw: []string{"ON"}}
	}
	t := parseTarget(b, on+1)
	if !t.present || t.pendingDot {
		return targetSpec(t, tkTable)
	}
	tbl := t.ref()
	past := b[t.end:]
	if len(past) == 0 {
		return spec{}
	}
	if o := open(past); o >= 0 {
		return spec{cols: colAll, kw: []string{"KEYS", "VALUES", "ENTRIES", "FULL"}, tbl: tbl}
	}
	return spec{kw: []string{"USING", "WITH OPTIONS"}, tbl: tbl}
}

func alterSpec(b, a []cql.Token) spec {
	if len(b) == 1 {
		return spec{kw: []string{"TABLE", "TYPE", "KEYSPACE", "MATERIALIZED VIEW", "ROLE", "USER"}}
	}
	switch up(b[1]) {
	case "TABLE", "COLUMNFAMILY":
		return alterObject(b, tkTable, tableOptions, true)
	case "TYPE":
		return alterObject(b, tkType, nil, false)
	case "KEYSPACE":
		t := parseTarget(b, 2)
		if !t.present || t.pendingDot {
			return targetSpec(t, tkKeyspace)
		}
		past := b[t.end:]
		if len(past) == 0 {
			return spec{kw: []string{"WITH"}}
		}
		return withSpec(past[1:], keyspaceOptions, nil)
	case "MATERIALIZED":
		if len(b) == 2 {
			return spec{kw: []string{"VIEW"}}
		}
		t := parseTarget(b, 3)
		if !t.present || t.pendingDot {
			return targetSpec(t, tkView)
		}
		if len(b) == t.end {
			return spec{kw: []string{"WITH"}}
		}
		return withSpec(b[t.end+1:], tableOptions, nil)
	}
	return spec{}
}

func alterObject(b []cql.Token, kind int, options []string, table bool) spec {
	i := 2
	if isWord(b[1], "TABLE") || isWord(b[1], "TYPE") {
		j := skipGuardExists(b, 2)
		if j < 0 {
			return spec{kw: []string{"EXISTS"}}
		}
		i = j
	}
	t := parseTarget(b, i)
	if !t.present || t.pendingDot {
		return targetSpec(t, kind, ifExists...)
	}
	tbl := t.ref()
	past := b[t.end:]
	if len(past) == 0 {
		if table {
			return spec{kw: []string{"ADD", "DROP", "RENAME", "WITH"}, tbl: tbl}
		}
		return spec{kw: []string{"ADD", "RENAME"}, tbl: tbl}
	}
	rest := past[1:]
	switch up(past[0]) {
	case "ADD":
		if len(rest) == 0 {
			return spec{kw: ifNotExists, tbl: tbl}
		}
		if isWord(rest[0], "IF") {
			return spec{kw: guardRest(rest, false), tbl: tbl}
		}
		seg := splitTop(rest)
		cur := seg[len(seg)-1]
		switch {
		case len(cur) == 0:
			return spec{tbl: tbl}
		case len(cur) == 1, angle(cur[1:]) > 0:
			return spec{types: true, tbl: tbl}
		}
		if table && !isWord(cur[len(cur)-1], "STATIC") {
			return spec{kw: []string{"STATIC"}, tbl: tbl}
		}
		return spec{tbl: tbl}
	case "DROP":
		if len(rest) == 0 {
			return spec{cols: colNonKey, kw: ifExists, tbl: tbl}
		}
		if t, _ := lastTok(rest); t.IsPunct(',') {
			return spec{cols: colNonKey, tbl: tbl}
		}
		return spec{tbl: tbl}
	case "RENAME":
		seg := splitTopWord(rest, "AND")
		cur := seg[len(seg)-1]
		switch len(cur) {
		case 0:
			return spec{cols: colAll, tbl: tbl}
		case 1:
			return spec{kw: []string{"TO"}, tbl: tbl}
		case 2:
			return spec{tbl: tbl}
		}
		return spec{kw: []string{"AND"}, tbl: tbl}
	case "WITH":
		s := withSpec(rest, options, nil)
		s.tbl = tbl
		if s.cols == colClustering {
			s.cols = colAll
		}
		return s
	}
	return spec{}
}

func skipGuardExists(b []cql.Token, i int) int {
	if i < len(b) && isWord(b[i], "IF") {
		for i < len(b) && (isWord(b[i], "IF") || isWord(b[i], "EXISTS")) {
			i++
		}
		if !isWord(b[i-1], "EXISTS") {
			return -1
		}
	}
	return i
}

func splitTopWord(b []cql.Token, w string) [][]cql.Token {
	var out [][]cql.Token
	start := 0
	for i, t := range b {
		if isWord(t, w) {
			out = append(out, b[start:i])
			start = i + 1
		}
	}
	return append(out, b[start:])
}
