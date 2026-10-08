package shell

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/0funct0ry/helenus/internal/config"
	"github.com/0funct0ry/helenus/internal/cql"
)

// logStatement records a CQL statement submitted to the server, for .save.
// Statements containing PASSWORD are never kept, as with history.
func (s *Shell) logStatement(stmt string) {
	if historyEntry(stmt) == "" {
		return
	}
	s.stmtLog = append(s.stmtLog, stmt)
	if limit := historyLimit(s.HistorySize); len(s.stmtLog) > limit {
		s.stmtLog = append([]string(nil), s.stmtLog[len(s.stmtLog)-limit:]...)
	}
}

// splitWords splits s on spaces, honouring single and double quotes.
func splitWords(s string) ([]string, error) {
	var out []string
	var cur strings.Builder
	var quote rune
	started := false
	for _, r := range s {
		switch {
		case quote != 0:
			if r == quote {
				quote = 0
			} else {
				cur.WriteRune(r)
			}
		case r == '\'' || r == '"':
			quote, started = r, true
		case r == ' ' || r == '\t':
			if started || cur.Len() > 0 {
				out = append(out, cur.String())
				cur.Reset()
				started = false
			}
		default:
			cur.WriteRune(r)
		}
	}
	if quote != 0 {
		return nil, syntaxErr("unterminated quote")
	}
	if started || cur.Len() > 0 {
		out = append(out, cur.String())
	}
	return out, nil
}

// saveArgs are the parsed arguments of .save.
type saveArgs struct {
	n      int // 0 = last statement
	all    bool
	force  bool
	db     bool
	global bool
	target string // path, or library name with --db
}

func parseSaveArgs(rest string) (saveArgs, error) {
	const usage = "usage: .save [-n N | -a] [-f] <path> | .save --db [-n N | -a] [-f] [--global] <name>"
	words, err := splitWords(rest)
	if err != nil {
		return saveArgs{}, err
	}
	var a saveArgs
	var pos []string
	for i := 0; i < len(words); i++ {
		switch w := words[i]; {
		case w == "-a":
			a.all = true
		case w == "-f":
			a.force = true
		case w == "--db":
			a.db = true
		case w == "--global":
			a.global = true
		case w == "-n":
			i++
			if i >= len(words) {
				return a, syntaxErr(usage)
			}
			n, err := strconv.Atoi(words[i])
			if err != nil || n < 1 {
				return a, syntaxErr("-n needs a positive number")
			}
			a.n = n
		default:
			pos = append(pos, w)
		}
	}
	if a.all && a.n > 0 {
		return a, syntaxErr("-n and -a cannot be combined")
	}
	if a.global && !a.db {
		return a, syntaxErr("--global only applies with --db")
	}
	if len(pos) == 0 || (!a.db && len(pos) != 1) {
		return a, syntaxErr(usage)
	}
	a.target = strings.Join(pos, " ")
	return a, nil
}

// selected returns the logged statements chosen by -n / -a (the last by default).
func (s *Shell) selected(a saveArgs) []string {
	n := len(s.stmtLog)
	switch {
	case n == 0:
		return nil
	case a.all:
		return s.stmtLog
	case a.n > 0:
		if a.n > n {
			return s.stmtLog
		}
		return s.stmtLog[n-a.n:]
	}
	return s.stmtLog[n-1:]
}

// formatStatements joins statements, each ending with ';', one blank line
// apart, with a final newline.
func formatStatements(stmts []string) string {
	parts := make([]string, len(stmts))
	for i, st := range stmts {
		st = strings.TrimSpace(st)
		if !strings.HasSuffix(st, ";") {
			st += ";"
		}
		parts[i] = st
	}
	return strings.Join(parts, "\n\n") + "\n"
}

// saveCmd implements .save for both files and the library.
func (s *Shell) saveCmd(line string) error {
	a, err := parseSaveArgs(rawArgs(line))
	if err != nil {
		return err
	}
	stmts := s.selected(a)
	if len(stmts) == 0 {
		fmt.Fprintln(s.Out, "nothing to save")
		return nil
	}
	text := formatStatements(stmts)
	if a.db {
		return s.saveToLibrary(a, text, len(stmts))
	}
	path, err := filepath.Abs(config.ExpandPath(a.target))
	if err != nil {
		return err
	}
	if fi, err := os.Stat(filepath.Dir(path)); err != nil || !fi.IsDir() {
		return fmt.Errorf("%s: directory does not exist", filepath.Dir(path))
	}
	if _, err := os.Stat(path); err == nil && !a.force {
		return fmt.Errorf("%s: file exists; use -f to overwrite", path)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		return err
	}
	fmt.Fprintf(s.Out, "Saved %d %s to %s\n", len(stmts), plural1(len(stmts), "statement"), path)
	return nil
}

// editorCommand returns the editor to run: $VISUAL, $EDITOR, then vi (notepad on Windows).
func editorCommand() string {
	for _, v := range []string{"VISUAL", "EDITOR"} {
		if e := strings.TrimSpace(os.Getenv(v)); e != "" {
			return e
		}
	}
	if runtime.GOOS == "windows" {
		return "notepad"
	}
	return "vi"
}

func (s *Shell) runEditor(path string) error {
	if s.Editor != nil {
		return s.Editor(path)
	}
	words, _ := splitWords(editorCommand())
	if len(words) == 0 {
		words = []string{"vi"}
	}
	cmd := exec.Command(words[0], append(words[1:], path)...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("editor %s: %w", words[0], err)
	}
	return nil
}

// ask prints prompt and returns the trimmed lower-case answer; without an
// interactive prompt it answers "" (no).
func (s *Shell) ask(prompt string) string {
	if s.Ask == nil {
		return ""
	}
	ans, err := s.Ask(prompt)
	if err != nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(ans))
}

// editAndRun edits path, then offers to run its statements; `e` edits again.
// It returns the final file content. A failing editor runs nothing.
func (s *Shell) editAndRun(ctx context.Context, path string) (string, error) {
	for {
		if err := s.runEditor(path); err != nil {
			return "", err
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		n := 0
		for _, st := range cql.Split(string(b)) {
			if strings.TrimSpace(st.Text) != "" {
				n++
			}
		}
		fmt.Fprintf(s.Out, "%d %s in %s\n", n, plural1(n, "statement"), path)
		switch s.ask("Run them? [y/N/e] ") {
		case "e":
			continue
		case "y", "yes":
			if err := s.runFile(ctx, path, string(b)); err != nil {
				return string(b), err
			}
		}
		return string(b), nil
	}
}

// openCmd implements .open <path>.
func (s *Shell) openCmd(ctx context.Context, line string) error {
	words, err := splitWords(rawArgs(line))
	if err != nil {
		return err
	}
	if len(words) != 1 {
		return syntaxErr("usage: .open <path>")
	}
	path, err := filepath.Abs(config.ExpandPath(words[0]))
	if err != nil {
		return err
	}
	_, err = s.editAndRun(ctx, path)
	if errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("%s: no such file (the editor did not save it)", path)
	}
	return err
}
