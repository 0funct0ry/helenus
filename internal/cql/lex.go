package cql

import "strings"

// TokenKind classifies a Token.
type TokenKind int

// Token kinds. Comments are skipped and never produced.
const (
	TokWord   TokenKind = iota // identifier or keyword
	TokQIdent                  // "quoted identifier"
	TokString                  // 'string' or $$ body $$
	TokNumber                  // 12, 1.5
	TokPunct                   // any other single byte
)

// Token is one lexical element of CQL text.
type Token struct {
	Kind TokenKind
	// Text is the raw source text of the token.
	Text string
	// Start and End are byte offsets in the input, End exclusive.
	Start, End int
	// Open marks a quoted token that never closed (the cursor is inside it).
	Open bool
}

// Upper returns the upper-cased text of a word token and "" for other kinds.
func (t Token) Upper() string {
	if t.Kind != TokWord {
		return ""
	}
	return strings.ToUpper(t.Text)
}

// Ident returns the identifier a word or quoted-identifier token denotes: a
// word is folded to lower case, a quoted identifier is unquoted verbatim.
func (t Token) Ident() string {
	switch t.Kind {
	case TokWord:
		return strings.ToLower(t.Text)
	case TokQIdent:
		s := strings.TrimPrefix(t.Text, `"`)
		if !t.Open {
			s = strings.TrimSuffix(s, `"`)
		}
		return strings.ReplaceAll(s, `""`, `"`)
	}
	return ""
}

// IsPunct reports whether t is the single punctuation byte p.
func (t Token) IsPunct(p byte) bool {
	return t.Kind == TokPunct && t.Text[0] == p
}

// Tokenize splits CQL text into tokens, dropping whitespace and comments.
// Quoted tokens left open at the end of the input are flagged Open.
func Tokenize(in string) []Token {
	var out []Token
	i := 0
	for i < len(in) {
		c := in[i]
		switch {
		case c == ' ' || c == '\t' || c == '\r' || c == '\n':
			i++
		case c == '-' && i+1 < len(in) && in[i+1] == '-', c == '/' && i+1 < len(in) && in[i+1] == '/':
			for i < len(in) && in[i] != '\n' {
				i++
			}
		case c == '/' && i+1 < len(in) && in[i+1] == '*':
			j := strings.Index(in[i+2:], "*/")
			if j < 0 {
				i = len(in)
			} else {
				i += 2 + j + 2
			}
		case c == '\'' || c == '"':
			j, ok := scanQuoted(in, i, c)
			kind := TokString
			if c == '"' {
				kind = TokQIdent
			}
			out = append(out, Token{Kind: kind, Text: in[i:j], Start: i, End: j, Open: !ok})
			i = j
		case c == '$' && i+1 < len(in) && in[i+1] == '$':
			j := strings.Index(in[i+2:], "$$")
			end := len(in)
			if j >= 0 {
				end = i + 2 + j + 2
			}
			out = append(out, Token{Kind: TokString, Text: in[i:end], Start: i, End: end, Open: j < 0})
			i = end
		case c >= '0' && c <= '9':
			j := i
			for j < len(in) && (isWordByte(in[j]) || (in[j] == '.' || in[j] == '-') && j+1 < len(in) && isWordByte(in[j+1])) {
				j++
			}
			out = append(out, Token{Kind: TokNumber, Text: in[i:j], Start: i, End: j})
			i = j
		case isWordByte(c):
			j := i
			for j < len(in) && isWordByte(in[j]) {
				j++
			}
			out = append(out, Token{Kind: TokWord, Text: in[i:j], Start: i, End: j})
			i = j
		default:
			out = append(out, Token{Kind: TokPunct, Text: in[i : i+1], Start: i, End: i + 1})
			i++
		}
	}
	return out
}
