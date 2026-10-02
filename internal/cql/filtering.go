package cql

import (
	"regexp"
	"strings"
)

var allowFilteringRe = regexp.MustCompile(`(?i)\ballow\s+filtering\b`)

// AppendAllowFiltering adds ALLOW FILTERING to a SELECT that lacks it, after
// LIMIT and before a trailing semicolon (SPEC §9.7). Other statements are
// returned unchanged.
func AppendAllowFiltering(stmt string) string {
	t := strings.TrimSpace(stmt)
	if !strings.EqualFold(firstWord(t), "SELECT") || allowFilteringRe.MatchString(stripStrings(t)) {
		return stmt
	}
	semi := strings.HasSuffix(t, ";")
	t = strings.TrimSpace(strings.TrimSuffix(t, ";"))
	t += " ALLOW FILTERING"
	if semi {
		t += ";"
	}
	return t
}

// IsSelect reports whether stmt is a SELECT.
func IsSelect(stmt string) bool {
	return strings.EqualFold(firstWord(strings.TrimSpace(stmt)), "SELECT")
}

// HasIF reports whether stmt contains an IF clause outside strings (a lightweight transaction).
func HasIF(stmt string) bool {
	for _, w := range strings.Fields(strings.ToUpper(stripStrings(stmt))) {
		if strings.Trim(w, ";(),") == "IF" {
			return true
		}
	}
	return false
}

// stripStrings blanks quoted strings and $$ bodies so keyword searches ignore them.
func stripStrings(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); {
		switch {
		case s[i] == '\'' || s[i] == '"':
			j, _ := scanQuoted(s, i, s[i])
			b.WriteString(" ")
			i = j
		case s[i] == '$' && i+1 < len(s) && s[i+1] == '$':
			j := strings.Index(s[i+2:], "$$")
			if j < 0 {
				i = len(s)
			} else {
				i += j + 4
			}
			b.WriteString(" ")
		default:
			b.WriteByte(s[i])
			i++
		}
	}
	return b.String()
}
