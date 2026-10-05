package history

import (
	"strings"

	"github.com/0funct0ry/helenus/internal/cql"
	"github.com/0funct0ry/helenus/internal/schema"
)

// stmt is a tokenized statement with its recognized target.
type stmt struct {
	src  string
	toks []cql.Token
	info Info
	// rest is the index of the first token after the target name.
	rest int
	// sig holds the argument types of a function or aggregate target, when written.
	sig    []string
	hasSig bool
	// onKS and onTable are the table named after ON in CREATE INDEX and CREATE TRIGGER.
	onKS, onTable string
}

func (s *stmt) up(i int) string {
	if i < 0 || i >= len(s.toks) {
		return ""
	}
	return s.toks[i].Upper()
}

// text returns the source between tokens [from, to).
func (s *stmt) text(from, to int) string {
	if from >= to || from >= len(s.toks) {
		return ""
	}
	return strings.TrimSpace(s.src[s.toks[from].Start:s.toks[to-1].End])
}

func isName(t cql.Token) bool { return t.Kind == cql.TokWord || t.Kind == cql.TokQIdent }

// name reads ident or ident.ident at i and returns the next index.
func (s *stmt) name(i int, currentKS string) (ks, name string, next int, ok bool) {
	if i >= len(s.toks) || !isName(s.toks[i]) {
		return "", "", i, false
	}
	name = s.toks[i].Ident()
	i++
	if i+1 < len(s.toks) && s.toks[i].IsPunct('.') && isName(s.toks[i+1]) {
		ks, name = name, s.toks[i+1].Ident()
		i += 2
	} else {
		ks = currentKS
	}
	return ks, name, i, true
}

// skipIf skips IF [NOT] EXISTS.
func (s *stmt) skipIf(i int) int {
	if s.up(i) != "IF" {
		return i
	}
	i++
	if s.up(i) == "NOT" {
		i++
	}
	if s.up(i) == "EXISTS" {
		i++
	}
	return i
}

func parse(src, currentKS string) *stmt {
	s := &stmt{src: src, toks: cql.Tokenize(src)}
	if len(s.toks) == 0 {
		return s
	}
	verb := s.up(0)
	i := 1
	switch verb {
	case "CREATE", "ALTER", "DROP":
		s.info.Action = strings.ToLower(verb)
		if verb == "CREATE" {
			if s.up(i) == "OR" && s.up(i+1) == "REPLACE" {
				i += 2
			}
			if s.up(i) == "CUSTOM" {
				i++
			}
		}
		kind := ""
		switch s.up(i) {
		case "KEYSPACE", "SCHEMA":
			kind, i = "keyspace", i+1
		case "TABLE", "COLUMNFAMILY":
			kind, i = "table", i+1
		case "TYPE":
			kind, i = "type", i+1
		case "MATERIALIZED":
			if s.up(i+1) == "VIEW" {
				kind, i = "view", i+2
			}
		case "INDEX":
			kind, i = "index", i+1
		case "FUNCTION":
			kind, i = "function", i+1
		case "AGGREGATE":
			kind, i = "aggregate", i+1
		case "TRIGGER":
			kind, i = "trigger", i+1
		case "ROLE", "USER":
			kind, i = "role", i+1
		}
		if kind == "" {
			s.info = Info{}
			return s
		}
		s.info.Kind = kind
		i = s.skipIf(i)
		if kind == "keyspace" || kind == "role" {
			if i < len(s.toks) && isName(s.toks[i]) {
				s.info.Name = s.toks[i].Ident()
				s.rest = i + 1
				if kind == "keyspace" {
					s.info.Keyspace = s.info.Name
				}
			}
			return s
		}
		if kind == "index" && s.up(i) == "ON" {
			s.rest = i
			s.parseOn(currentKS)
			return s
		}
		ks, name, next, ok := s.name(i, currentKS)
		if !ok {
			return s
		}
		s.info.Keyspace, s.info.Name, s.rest = ks, name, next
		if s.info.Action == "create" && (kind == "index" || kind == "trigger") {
			s.parseOn(currentKS)
			if kind == "trigger" {
				s.info.Keyspace = s.onKS
			}
		}
		if (kind == "function" || kind == "aggregate") && s.rest < len(s.toks) && s.toks[s.rest].IsPunct('(') {
			s.parseSig()
		}
	case "TRUNCATE":
		s.info.Action, s.info.Kind = "truncate", "table"
		if s.up(i) == "TABLE" || s.up(i) == "COLUMNFAMILY" {
			i++
		}
		if ks, name, next, ok := s.name(i, currentKS); ok {
			s.info.Keyspace, s.info.Name, s.rest = ks, name, next
		}
	case "GRANT", "REVOKE":
		s.info.Action, s.info.Kind = strings.ToLower(verb), "permission"
		// The role is the name after the last TO (GRANT) or FROM (REVOKE).
		want := "TO"
		if verb == "REVOKE" {
			want = "FROM"
		}
		for j := len(s.toks) - 2; j > 0; j-- {
			if s.up(j) == want && isName(s.toks[j+1]) {
				s.info.Name = s.toks[j+1].Ident()
				break
			}
		}
	}
	return s
}

// parseOn reads "ON [ks.]table" at s.rest. A CREATE INDEX without a name gets the name
// Cassandra generates, <table>_<column>_idx, when the target is one plain column.
func (s *stmt) parseOn(currentKS string) {
	if s.up(s.rest) != "ON" {
		return
	}
	ks, tb, next, ok := s.name(s.rest+1, currentKS)
	if !ok {
		return
	}
	s.onKS, s.onTable = ks, tb
	if s.info.Kind != "index" {
		return
	}
	if s.info.Keyspace == "" {
		s.info.Keyspace = ks
	}
	if s.info.Name == "" && next+2 < len(s.toks) && s.toks[next].IsPunct('(') && isName(s.toks[next+1]) && s.toks[next+2].IsPunct(')') {
		s.info.Name = tb + "_" + s.toks[next+1].Ident() + "_idx"
	}
}

// parseSig reads (type, type, …) of a function or aggregate target; function arguments
// are "name type" pairs and only the type part is kept.
func (s *stmt) parseSig() {
	s.hasSig = true
	depth := 0
	start := s.rest + 1
	var parts [][2]int
	for j := s.rest; j < len(s.toks); j++ {
		t := s.toks[j]
		switch {
		case t.IsPunct('(') || t.IsPunct('<'):
			depth++
		case t.IsPunct(')') || t.IsPunct('>'):
			depth--
			if depth == 0 {
				if start < j {
					parts = append(parts, [2]int{start, j})
				}
				s.rest = j + 1
				goto done
			}
		case t.IsPunct(',') && depth == 1:
			parts = append(parts, [2]int{start, j})
			start = j + 1
		}
	}
	s.rest = len(s.toks)
done:
	for _, p := range parts {
		from := p[0]
		// "name type" in CREATE FUNCTION: the first token is a name when a type follows it.
		if s.info.Action == "create" && s.info.Kind == "function" && from+1 < p[1] {
			from++
		}
		s.sig = append(s.sig, normalizeType(s.text(from, p[1])))
	}
}

func normalizeType(t string) string {
	return strings.Join(strings.Fields(strings.ToLower(t)), " ")
}

// splitTop splits toks on separators found at bracket depth 0.
func splitTop(toks []cql.Token, sep func(cql.Token) bool) [][]cql.Token {
	var out [][]cql.Token
	depth, start := 0, 0
	for i, t := range toks {
		switch {
		case t.IsPunct('(') || t.IsPunct('{') || t.IsPunct('[') || t.IsPunct('<'):
			depth++
		case t.IsPunct(')') || t.IsPunct('}') || t.IsPunct(']') || t.IsPunct('>'):
			depth--
		case depth == 0 && sep(t):
			out = append(out, toks[start:i])
			start = i + 1
		}
	}
	return append(out, toks[start:])
}

func isComma(t cql.Token) bool { return t.IsPunct(',') }
func isAnd(t cql.Token) bool   { return t.Upper() == "AND" }

func ident(t cql.Token) string { return schema.Ident(t.Ident()) }
