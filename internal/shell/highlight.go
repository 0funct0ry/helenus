package shell

import (
	"strings"

	"github.com/0funct0ry/helenus/internal/cql"
)

// Colors for CQL syntax highlighting. They are only used when output is styled.
const (
	ansiKeyword  = "\x1b[1;35m"
	ansiType     = "\x1b[36m"
	ansiString   = "\x1b[32m"
	ansiComment  = "\x1b[90m"
	ansiQuoted   = "\x1b[4m"
	ansiTemplate = "\x1b[3;33m"
	ansiLiteral  = "\x1b[35m"
)

// highlightCQL colors CQL text: keywords, types, strings, numbers, comments, quoted identifiers
// and {{ template actions }} of alias bodies. Whitespace and layout are kept exactly. With
// styled false it returns s unchanged.
func highlightCQL(s string, styled bool) string {
	if !styled || s == "" {
		return s
	}
	var b strings.Builder
	i := 0
	for i < len(s) {
		c := s[i]
		switch {
		case c == '{' && strings.HasPrefix(s[i:], "{{") && strings.Contains(s[i:], "}}"):
			j := i + strings.Index(s[i:], "}}") + 2
			b.WriteString(paint(ansiTemplate, s[i:j], true))
			i = j
		case c == '-' && strings.HasPrefix(s[i:], "--"), c == '/' && strings.HasPrefix(s[i:], "//"):
			j := i
			for j < len(s) && s[j] != '\n' {
				j++
			}
			b.WriteString(paint(ansiComment, s[i:j], true))
			i = j
		case c == '/' && strings.HasPrefix(s[i:], "/*"):
			j := len(s)
			if k := strings.Index(s[i+2:], "*/"); k >= 0 {
				j = i + 2 + k + 2
			}
			b.WriteString(paint(ansiComment, s[i:j], true))
			i = j
		case c == '\'':
			j := scanQuote(s, i, '\'')
			b.WriteString(paint(ansiString, s[i:j], true))
			i = j
		case c == '"':
			j := scanQuote(s, i, '"')
			b.WriteString(paint(ansiQuoted, s[i:j], true))
			i = j
		case c == '$' && strings.HasPrefix(s[i:], "$$"):
			j := len(s)
			if k := strings.Index(s[i+2:], "$$"); k >= 0 {
				j = i + 2 + k + 2
			}
			b.WriteString(paint(ansiString, s[i:j], true))
			i = j
		case c >= '0' && c <= '9':
			j := i
			for j < len(s) && (isWordChar(s[j]) || (s[j] == '.' || s[j] == '-') && j+1 < len(s) && isWordChar(s[j+1])) {
				j++
			}
			b.WriteString(paint(ansiNumber, s[i:j], true))
			i = j
		case isWordChar(c):
			j := i
			for j < len(s) && isWordChar(s[j]) {
				j++
			}
			w := s[i:j]
			switch lw := strings.ToLower(w); {
			case lw == "null" || lw == "true" || lw == "false":
				b.WriteString(paint(ansiLiteral, w, true))
			case cql.IsTypeName(w) && !followedByParen(s, j):
				b.WriteString(paint(ansiType, w, true))
			case cql.IsKeyword(w):
				b.WriteString(paint(ansiKeyword, w, true))
			default:
				b.WriteString(w)
			}
			i = j
		default:
			b.WriteByte(c)
			i++
		}
	}
	return b.String()
}

func isWordChar(c byte) bool {
	return c == '_' || c >= '0' && c <= '9' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= 0x80
}

func followedByParen(s string, i int) bool { return i < len(s) && s[i] == '(' }

// scanQuote returns the index after the closing quote that starts at i; a doubled quote is an
// escape. An unterminated string runs to the end of the text.
func scanQuote(s string, i int, q byte) int {
	for j := i + 1; j < len(s); j++ {
		if s[j] == q {
			if j+1 < len(s) && s[j+1] == q {
				j++
				continue
			}
			return j + 1
		}
	}
	return len(s)
}
