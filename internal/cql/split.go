// Package cql holds the CQL lexer, statement splitter and literal helpers
// shared by the shell and the web editor (SPEC §7.1, §7.2).
package cql

import (
	"strings"
)

// Statement is one statement found in an input.
type Statement struct {
	// Text is the statement with comments stripped and surrounding whitespace
	// trimmed. It includes the terminating semicolon when one was present.
	Text string `json:"text"`
	// Start and End are byte offsets of the statement in the input, End exclusive.
	// The span runs from the first token to the terminating semicolon.
	Start int `json:"start"`
	End   int `json:"end"`
	// Line is the 1-based line of Start.
	Line int `json:"line"`
	// Complete is false for a trailing statement with no terminating semicolon
	// (or an unterminated string, comment or batch).
	Complete bool `json:"complete"`
	// Meta marks a shell meta-command, which needs no semicolon.
	Meta bool `json:"meta,omitempty"`
}

var metaWords = map[string]bool{
	"CONSISTENCY": true, "SERIAL": true, "TRACING": true, "TIMING": true, "EXPAND": true,
	"FORMAT": true, "PAGING": true, "DESCRIBE": true, "DESC": true, "SHOW": true, "SOURCE": true,
	"CLEAR": true, "CLS": true, "HELP": true, "EXIT": true, "QUIT": true, "USE": true,
}

// IsMetaStart reports whether line begins with a shell meta-command.
func IsMetaStart(line string) bool {
	line = strings.TrimSpace(line)
	if line == "" {
		return false
	}
	if line[0] == '\\' || line[0] == ':' {
		return true
	}
	return metaWords[strings.ToUpper(firstWord(line))]
}

func firstWord(s string) string {
	end := 0
	for end < len(s) && isWordByte(s[end]) {
		end++
	}
	return s[:end]
}

func isWordByte(b byte) bool {
	return b == '_' || b >= '0' && b <= '9' || b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z'
}

type splitter struct {
	in    string
	out   []Statement
	buf   strings.Builder
	start int // offset of first token, -1 when no statement in progress
	line  int
	words []string // upper-cased word tokens of the current statement
	meta  bool
	batch bool
}

// Split breaks input into statements. See SPEC §7.1.
func Split(input string) []Statement {
	s := &splitter{in: input, start: -1}
	return s.run()
}

func (s *splitter) run() []Statement {
	in := s.in
	line := 1
	i := 0
	for i < len(in) {
		c := in[i]
		switch {
		case c == '\n':
			if s.meta && s.start >= 0 {
				s.finish(i, true)
			} else if s.start >= 0 {
				s.buf.WriteByte(c)
			}
			line++
			i++
		case c == ' ' || c == '\t' || c == '\r':
			if s.start >= 0 {
				s.buf.WriteByte(c)
			}
			i++
		case c == '-' && i+1 < len(in) && in[i+1] == '-', c == '/' && i+1 < len(in) && in[i+1] == '/':
			for i < len(in) && in[i] != '\n' {
				i++
			}
			s.sep()
		case c == '/' && i+1 < len(in) && in[i+1] == '*':
			j := strings.Index(in[i+2:], "*/")
			if j < 0 {
				// Unterminated block comment swallows the rest.
				line += strings.Count(in[i:], "\n")
				i = len(in)
				s.sep()
				continue
			}
			end := i + 2 + j + 2
			line += strings.Count(in[i:end], "\n")
			i = end
			s.sep()
		case c == '\'' || c == '"':
			s.begin(i, line)
			j, ok := scanQuoted(in, i, c)
			line += strings.Count(in[i:j], "\n")
			s.buf.WriteString(in[i:j])
			i = j
			if !ok {
				s.finish(len(in), false)
				return s.out
			}
		case c == '$' && i+1 < len(in) && in[i+1] == '$':
			s.begin(i, line)
			j := strings.Index(in[i+2:], "$$")
			if j < 0 {
				s.buf.WriteString(in[i:])
				i = len(in)
				s.finish(i, false)
				return s.out
			}
			end := i + 2 + j + 2
			line += strings.Count(in[i:end], "\n")
			s.buf.WriteString(in[i:end])
			i = end
		case c == ';':
			if s.start < 0 {
				i++
				continue
			}
			if s.batch && !s.batchEnded() {
				s.buf.WriteByte(c)
				i++
				continue
			}
			s.buf.WriteByte(c)
			i++
			s.finish(i, true)
		case isWordByte(c):
			j := i
			for j < len(in) && isWordByte(in[j]) {
				j++
			}
			if s.start < 0 {
				// Start of a statement: meta-command lines need no semicolon.
				if IsMetaStart(in[i:lineEnd(in, i)]) {
					s.meta = true
				}
			}
			s.begin(i, line)
			w := strings.ToUpper(in[i:j])
			s.words = append(s.words, w)
			if len(s.words) <= 3 && s.words[0] == "BEGIN" && w == "BATCH" {
				s.batch = true
			}
			s.buf.WriteString(in[i:j])
			i = j
		case (c == '\\' || c == ':') && s.start < 0 && IsMetaStart(in[i:lineEnd(in, i)]):
			s.begin(i, line)
			s.meta = true
			s.buf.WriteByte(c)
			i++
		default:
			s.begin(i, line)
			s.buf.WriteByte(c)
			i++
		}
	}
	if s.start >= 0 {
		s.finish(len(in), s.meta)
	}
	return s.out
}

func lineEnd(in string, i int) int {
	if j := strings.IndexByte(in[i:], '\n'); j >= 0 {
		return i + j
	}
	return len(in)
}

// sep keeps tokens on either side of a comment from fusing together.
func (s *splitter) sep() {
	if s.start >= 0 {
		s.buf.WriteByte(' ')
	}
}

func (s *splitter) begin(at, line int) {
	if s.start < 0 {
		s.start = at
		s.line = line
	}
}

func (s *splitter) batchEnded() bool {
	n := len(s.words)
	return n >= 2 && s.words[n-2] == "APPLY" && s.words[n-1] == "BATCH"
}

func (s *splitter) finish(end int, complete bool) {
	text := strings.TrimSpace(s.buf.String())
	if text != "" {
		// Trim trailing whitespace from the span, too.
		for end > s.start && strings.ContainsRune(" \t\r\n", rune(s.in[end-1])) {
			end--
		}
		if s.batch && !s.batchEnded() {
			complete = false
		}
		s.out = append(s.out, Statement{Text: text, Start: s.start, End: end, Line: s.line, Complete: complete, Meta: s.meta})
	}
	s.buf.Reset()
	s.start, s.words, s.meta, s.batch = -1, nil, false, false
}

// scanQuoted returns the index after the closing quote of the string starting at
// in[i], honoring doubled-quote escapes. ok is false if it never closes.
func scanQuoted(in string, i int, q byte) (int, bool) {
	j := i + 1
	for j < len(in) {
		if in[j] == q {
			if j+1 < len(in) && in[j+1] == q {
				j += 2
				continue
			}
			return j + 1, true
		}
		j++
	}
	return len(in), false
}
