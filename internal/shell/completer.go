package shell

import (
	"context"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/0funct0ry/helenus/internal/complete"
	"github.com/0funct0ry/helenus/internal/schema"
)

// completeTimeout bounds the first tab press, which may have to read the schema.
const completeTimeout = 3 * time.Second

// completer adapts the shared completion engine (SPEC §10) to readline's tab key. Readline lists
// the candidates in aligned columns when there are several and cycles through them on repeated
// presses.
type completer struct{ s *Shell }

// Do implements readline.AutoCompleter. Readline wants only the text to append after the
// word being typed, so candidates whose insert text does not extend that word are dropped.
func (c completer) Do(line []rune, pos int) ([][]rune, int) {
	s := c.s
	text := strings.Join(s.pending, "\n")
	if len(s.pending) > 0 {
		text += "\n"
	}
	cursor := len(text) + len(string(line[:pos]))
	text += string(line)

	var snap *schema.Snapshot
	if s.Schema != nil {
		ctx, cancel := context.WithTimeout(context.Background(), completeTimeout)
		snap, _ = s.Schema(ctx)
		cancel()
	}
	res := complete.Complete(context.Background(), snap, s.Keyspace, text, cursor)
	prefix := text[res.From:cursor]
	lower := wantsLower(text[:cursor], prefix)

	var out [][]rune
	seen := map[string]bool{}
	for _, it := range res.Items {
		ins := it.Insert
		if len(ins) < len(prefix) || !strings.EqualFold(ins[:len(prefix)], prefix) {
			continue
		}
		suffix := ins[len(prefix):]
		if lower && (it.Kind == complete.KindKeyword || it.Kind == complete.KindCommand) {
			suffix = strings.ToLower(suffix)
		}
		if seen[suffix] {
			continue
		}
		seen[suffix] = true
		out = append(out, []rune(suffix))
	}
	return out, utf8.RuneCountInString(prefix)
}

// wantsLower reports whether the user is typing keywords in lower case: the word being typed, or
// the one before it when none is started, has lower-case letters only.
func wantsLower(before, prefix string) bool {
	w := prefix
	if w == "" {
		w = strings.TrimRightFunc(before, unicode.IsSpace)
		if i := strings.LastIndexFunc(w, func(r rune) bool { return !unicode.IsLetter(r) && r != '_' }); i >= 0 {
			_, n := utf8.DecodeRuneInString(w[i:])
			w = w[i+n:]
		}
	}
	hasLower := false
	for _, r := range w {
		if unicode.IsUpper(r) {
			return false
		}
		if unicode.IsLower(r) {
			hasLower = true
		}
	}
	return hasLower
}
