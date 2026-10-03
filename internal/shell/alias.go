package shell

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/0funct0ry/helenus/internal/config"
	"github.com/0funct0ry/helenus/internal/cql"
)

// maxAliasDepth stops aliases that invoke themselves.
const maxAliasDepth = 10

// aliasState is the productivity-layer state of a shell session.
type aliasState struct {
	aliases map[string]string
	vars    map[string]string
	depth   int
	// expansions collects the CQL produced by alias invocations so the REPL can store it in
	// history next to the invocation.
	expansions []string
}

func (s *Shell) aliasNames() []string {
	names := make([]string, 0, len(s.aliases))
	for n := range s.aliases {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}

// DefineAlias sets an alias for this session (used to load the config file's aliases).
func (s *Shell) DefineAlias(name, body string) {
	if s.aliases == nil {
		s.aliases = map[string]string{}
	}
	s.aliases[name] = body
}

// templateData is what alias bodies see: built-ins win over \set variables.
func (s *Shell) templateData() map[string]any {
	d := map[string]any{}
	for k, v := range s.vars {
		d[k] = v
	}
	d["keyspace"] = s.Keyspace
	d["profile"] = s.Profile
	d["consistency"] = s.Consistency
	return d
}

func validAliasName(n string) bool {
	if n == "" {
		return false
	}
	for _, r := range n {
		if !(r == '_' || r == '-' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9') {
			return false
		}
	}
	return true
}

// splitArgs splits on whitespace, honoring '…' and "…" quotes (quotes are removed).
func splitArgs(s string) ([]string, error) {
	var out []string
	var cur strings.Builder
	in := false
	var q rune
	for _, r := range s {
		switch {
		case q != 0:
			if r == q {
				q = 0
			} else {
				cur.WriteRune(r)
			}
		case r == '\'' || r == '"':
			q, in = r, true
		case r == ' ' || r == '\t' || r == '\n':
			if in {
				out = append(out, cur.String())
				cur.Reset()
				in = false
			}
		default:
			cur.WriteRune(r)
			in = true
		}
	}
	if q != 0 {
		return nil, syntaxErr("unterminated quote in alias arguments")
	}
	if in {
		out = append(out, cur.String())
	}
	return out, nil
}

// expandAlias renders the alias invoked by line (":name args…").
func (s *Shell) expandAlias(line string) (string, error) {
	line = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(line), ";"))
	rest := strings.TrimPrefix(line, ":")
	name, argText, _ := strings.Cut(rest, " ")
	body, ok := s.aliases[name]
	if !ok {
		return "", fmt.Errorf("unknown alias %q (.alias lists them)", name)
	}
	args, err := splitArgs(argText)
	if err != nil {
		return "", err
	}
	return expandTemplate(body, s.templateData(), args)
}

// invokeAlias expands and runs ":name args…".
func (s *Shell) invokeAlias(ctx context.Context, line string) error {
	if s.depth >= maxAliasDepth {
		return errors.New("aliases nested too deeply")
	}
	out, err := s.expandAlias(line)
	if err != nil {
		return err
	}
	s.expansions = append(s.expansions, out)
	s.depth++
	defer func() { s.depth-- }()
	for _, st := range cql.Split(out) {
		if err := s.Execute(ctx, st.Text); err != nil {
			return err
		}
	}
	return nil
}

// rawArgs returns the text after the command word of line.
func rawArgs(line string) string {
	_, rest, _ := strings.Cut(strings.TrimSpace(line), " ")
	return strings.TrimSpace(rest)
}

func (s *Shell) aliasCmd(line string) error {
	rest := rawArgs(line)
	switch {
	case rest == "":
		if len(s.aliases) == 0 {
			fmt.Fprintln(s.Out, "No aliases defined.")
			return nil
		}
		var rows [][]string
		for _, n := range s.aliasNames() {
			first, _, multi := strings.Cut(strings.TrimSpace(s.aliases[n]), "\n")
			if multi {
				first += " …"
			}
			rows = append(rows, []string{":" + n, first})
		}
		s.printCodeTable([]string{"alias", "body"}, rows, map[int]bool{1: true})
		return nil
	case strings.HasPrefix(rest, "--dry-run"):
		inv := strings.TrimSpace(strings.TrimPrefix(rest, "--dry-run"))
		if !strings.HasPrefix(inv, ":") {
			return syntaxErr(`usage: .alias --dry-run :name [args…]`)
		}
		out, err := s.expandAlias(inv)
		if err != nil {
			return err
		}
		s.code(strings.TrimSpace(out) + "\n")
		return nil
	case strings.HasPrefix(rest, "--save"):
		return s.saveAliases(strings.TrimSpace(strings.TrimPrefix(rest, "--save")))
	}
	name, body, hasBody := strings.Cut(rest, "=")
	name = strings.TrimSpace(name)
	if !validAliasName(name) {
		return syntaxErr(`usage: .alias [name [= body]]`)
	}
	if !hasBody {
		b, ok := s.aliases[name]
		if !ok {
			return fmt.Errorf("unknown alias %q", name)
		}
		fmt.Fprintf(s.Out, "%s = ", paint(ansiHeader+"\x1b[1m", name, s.Styled))
		s.code(strings.TrimRight(b, "\n") + "\n")
		return nil
	}
	body = strings.TrimSpace(body)
	if body == "" {
		return syntaxErr(`usage: .alias name = body`)
	}
	s.DefineAlias(name, body)
	return nil
}

func (s *Shell) saveAliases(name string) error {
	if s.ConfigPath == "" {
		return errors.New("no config file to save to")
	}
	names := s.aliasNames()
	if name != "" {
		if _, ok := s.aliases[name]; !ok {
			return fmt.Errorf("unknown alias %q", name)
		}
		names = []string{name}
	}
	w := config.Writer{Path: s.ConfigPath}
	for _, n := range names {
		if err := w.SetShellEntry("aliases", n, s.aliases[n]); err != nil {
			return err
		}
	}
	fmt.Fprintf(s.Out, "Saved %d %s to %s.\n", len(names), plural1(len(names), "alias"), s.ConfigPath)
	return nil
}

func (s *Shell) unalias(line string) error {
	name := rawArgs(line)
	if name == "" || strings.ContainsAny(name, " \t") {
		return syntaxErr(`usage: .unalias <name>`)
	}
	if _, ok := s.aliases[name]; !ok {
		return fmt.Errorf("unknown alias %q", name)
	}
	delete(s.aliases, name)
	return nil
}

func (s *Shell) setVar(line string) error {
	rest := rawArgs(line)
	if rest == "" {
		keys := make([]string, 0, len(s.vars))
		for k := range s.vars {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		if len(keys) == 0 {
			fmt.Fprintln(s.Out, "No variables set.")
			return nil
		}
		rows := make([][]string, len(keys))
		for i, k := range keys {
			rows[i] = []string{k, s.vars[k]}
		}
		s.printTable([]string{"variable", "value"}, rows)
		return nil
	}
	name, val, _ := strings.Cut(rest, " ")
	if !validAliasName(name) {
		return syntaxErr(`usage: .set [name [value]]`)
	}
	if s.vars == nil {
		s.vars = map[string]string{}
	}
	s.vars[name] = strings.TrimSpace(val)
	return nil
}

func (s *Shell) unsetVar(line string) error {
	name := rawArgs(line)
	if _, ok := s.vars[name]; !ok {
		return fmt.Errorf("unknown variable %q", name)
	}
	delete(s.vars, name)
	return nil
}

func (s *Shell) abbrevCmd() error {
	keys := make([]string, 0, len(s.Abbreviations))
	for k := range s.Abbreviations {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if len(keys) == 0 {
		fmt.Fprintln(s.Out, "No abbreviations defined.")
	}
	if len(keys) == 0 {
		return nil
	}
	rows := make([][]string, len(keys))
	for i, k := range keys {
		rows[i] = []string{k, s.Abbreviations[k]}
	}
	s.printCodeTable([]string{"abbreviation", "expands to"}, rows, map[int]bool{1: true})
	return nil
}

// abbreviationListener expands an abbreviation when space is typed right after it at the start
// of a statement. It is a readline Listener.
func (s *Shell) abbreviationListener(line []rune, pos int, key rune) ([]rune, int, bool) {
	if key != ' ' || len(s.pending) > 0 || len(s.Abbreviations) == 0 || pos != len(line) {
		return nil, 0, false
	}
	word := strings.TrimSuffix(string(line), " ")
	exp, ok := s.Abbreviations[word]
	if !ok {
		return nil, 0, false
	}
	if !strings.HasSuffix(exp, " ") && !strings.HasSuffix(exp, ";") {
		exp += " "
	}
	out := []rune(exp)
	return out, len(out), true
}
