package shell

import (
	"context"
	"os"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/0funct0ry/helenus/internal/complete"
	"github.com/0funct0ry/helenus/internal/config"
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
	if out, n, ok := s.argCompletion(string(line[:pos])); ok {
		return out, n
	}
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
	res := complete.CompleteWith(context.Background(), snap, s.Keyspace, text, cursor, s.aliasNames())
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
		if lower && (it.Kind == complete.KindKeyword || it.Kind == complete.KindCommand) && !strings.Contains(it.Detail, "consistency level") {
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

// argCompletion completes file paths for .save, .open and .source and library
// names for .load and .save --db. ok is false for any other line.
func (s *Shell) argCompletion(before string) (out [][]rune, n int, ok bool) {
	if len(s.pending) > 0 || !strings.HasPrefix(before, ".") {
		return nil, 0, false
	}
	cmd, rest, found := strings.Cut(before, " ")
	if !found {
		return nil, 0, false
	}
	cmd = strings.ToLower(cmd)
	switch cmd {
	case ".source", ".open":
		return pathCandidates(strings.TrimLeft(rest, " "))
	case ".save":
		if !strings.Contains(" "+rest, " --db ") {
			word := rest[strings.LastIndexAny(rest, " ")+1:]
			if strings.HasPrefix(word, "-") {
				return nil, 0, true
			}
			return pathCandidates(word)
		}
	case ".load":
	default:
		return nil, 0, false
	}
	return s.nameCandidates(rest)
}

// nameCandidates completes the library name that ends rest, skipping flags.
func (s *Shell) nameCandidates(rest string) ([][]rune, int, bool) {
	words := strings.Split(rest, " ")
	i := 0
	for i < len(words)-1 && (strings.HasPrefix(words[i], "-") || words[i] == "" || (i > 0 && words[i-1] == "-n")) {
		i++
	}
	prefix := strings.TrimLeft(strings.Join(words[i:], " "), `'"`)
	if strings.HasPrefix(prefix, "-") {
		return nil, 0, true
	}
	var out [][]rune
	seen := map[string]bool{}
	for _, name := range s.LibraryNames() {
		if len(name) >= len(prefix) && strings.EqualFold(name[:len(prefix)], prefix) && !seen[name] {
			seen[name] = true
			out = append(out, []rune(name[len(prefix):]))
		}
	}
	return out, utf8.RuneCountInString(prefix), true
}

// pathCandidates completes a file path; directories end with "/".
func pathCandidates(word string) ([][]rune, int, bool) {
	word = strings.TrimLeft(word, `'"`)
	dirPart, base := "", word
	if i := strings.LastIndex(word, "/"); i >= 0 {
		dirPart, base = word[:i+1], word[i+1:]
	}
	dir := config.ExpandPath(strings.TrimSuffix(dirPart, "/"))
	switch {
	case dirPart == "":
		dir = "."
	case dir == "":
		dir = "/"
	}
	if word == "~" {
		return [][]rune{[]rune("/")}, 1, true
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, 0, true
	}
	var out [][]rune
	for _, e := range entries {
		name := e.Name()
		if !strings.HasPrefix(name, base) || (strings.HasPrefix(name, ".") && !strings.HasPrefix(base, ".")) {
			continue
		}
		suffix := name[len(base):]
		if e.IsDir() {
			suffix += "/"
		}
		out = append(out, []rune(suffix))
	}
	return out, utf8.RuneCountInString(base), true
}
