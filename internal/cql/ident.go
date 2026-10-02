package cql

import "strings"

var reserved = map[string]bool{}

func init() {
	for _, w := range strings.Fields(`add allow alter and apply asc authorize batch begin by columnfamily create delete desc describe
		drop entries execute from full grant if in index infinity insert into is keyspace limit materialized modify nan norecursive
		not null of on or orderby primary rename replace revoke schema select set table to token truncate unlogged update use using
		view where with`) {
		reserved[w] = true
	}
}

// QuoteIdent quotes an identifier that is a reserved word, has uppercase
// letters, or has characters outside [a-z0-9_] (or starts with a digit).
func QuoteIdent(id string) string {
	need := id == "" || reserved[id]
	for i := 0; i < len(id) && !need; i++ {
		b := id[i]
		if !(b == '_' || b >= 'a' && b <= 'z' || b >= '0' && b <= '9') {
			need = true
		}
	}
	if !need && id[0] >= '0' && id[0] <= '9' {
		need = true
	}
	if !need {
		return id
	}
	return `"` + strings.ReplaceAll(id, `"`, `""`) + `"`
}

// QuoteString renders s as a CQL string literal.
func QuoteString(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
