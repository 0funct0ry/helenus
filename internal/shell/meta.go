package shell

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/0funct0ry/helenus/internal/schema"
)

var consistencyLevels = []string{"ANY", "ONE", "TWO", "THREE", "QUORUM", "ALL", "LOCAL_QUORUM", "EACH_QUORUM", "SERIAL", "LOCAL_SERIAL", "LOCAL_ONE"}

const defaultPaging = 100

// syntaxErr is a malformed meta-command.
type syntaxErr string

func (e syntaxErr) Error() string { return "SyntaxError: " + string(e) }

// meta runs a meta-command. handled is false when the line is really CQL
// (USE and DESCRIBE-less CQL fall through to the executor).
func (s *Shell) meta(ctx context.Context, line string) (handled bool, err error) {
	words := strings.Fields(line)
	cmd := strings.ToUpper(words[0])
	args := words[1:]
	switch {
	case cmd == "EXIT" || cmd == "QUIT":
		return true, ErrExit
	case cmd == "USE":
		return false, nil
	case cmd == "DESCRIBE" || cmd == "DESC":
		return true, s.describe(ctx, line)
	case cmd == "SHOW":
		return true, s.show(ctx, args)
	case cmd == "CONSISTENCY":
		return true, s.consistency(args)
	case cmd == "SERIAL":
		return true, s.serial(args)
	case cmd == "EXPAND":
		return true, s.expand(args)
	case cmd == "FORMAT":
		return true, s.format(args)
	case cmd == "PAGING":
		return true, s.paging(args)
	case cmd == "SOURCE":
		return true, s.source(ctx, line)
	case cmd == "CLEAR" || cmd == "CLS":
		s.clear()
		return true, nil
	case cmd == "HELP":
		s.help(args)
		return true, nil
	case cmd == `\PROFILE`:
		return true, s.profile(ctx, args)
	case cmd == "TRACING":
		return true, s.toggle("Tracing", &s.Tracing, args)
	case cmd == "TIMING":
		return true, s.toggle("Timing", &s.Timing, args)
	case strings.HasPrefix(cmd, `\`) || strings.HasPrefix(cmd, ":"):
		return true, errors.New("aliases and variables are not available yet (planned for M8)")
	}
	return false, nil
}

func (s *Shell) describe(ctx context.Context, stmt string) error {
	t, err := schema.ParseDescribe(stmt)
	if err != nil {
		return syntaxErr(err.Error())
	}
	if s.Describer == nil {
		return errors.New("not connected")
	}
	out, err := s.Describer.Describe(ctx, t, s.Keyspace)
	if err != nil {
		return err
	}
	fmt.Fprint(s.Out, out)
	return nil
}

func (s *Shell) show(ctx context.Context, args []string) error {
	if len(args) >= 1 && strings.EqualFold(args[0], "SESSION") {
		return s.showSession(ctx, args[1:])
	}
	if len(args) == 1 && s.Cluster != nil {
		switch strings.ToUpper(args[0]) {
		case "VERSION":
			proto := ""
			if p := s.Cluster.ProtocolVersion; p != "" {
				proto = " | Native protocol v" + strings.TrimPrefix(p, "v")
			}
			fmt.Fprintf(s.Out, "[helenus %s | Cassandra %s | CQL spec %s%s]\n", s.Version, s.Cluster.ReleaseVersion, s.Cluster.CQLVersion, proto)
			return nil
		case "HOST":
			fmt.Fprintf(s.Out, "Connected to %s at %s:%d\n", s.Cluster.Name, s.Host, s.Port)
			return nil
		}
	}
	return syntaxErr("SHOW supports VERSION, HOST and SESSION <trace-id>")
}

// toggle implements TRACING and TIMING: no argument shows the state.
func (s *Shell) toggle(name string, flag *bool, args []string) error {
	switch len(args) {
	case 0:
		state := "off"
		if *flag {
			state = "on"
		}
		fmt.Fprintf(s.Out, "%s is %s.\n", name, state)
	case 1:
		switch strings.ToUpper(args[0]) {
		case "ON":
			*flag = true
		case "OFF":
			*flag = false
		default:
			return syntaxErr("usage: " + strings.ToUpper(name) + " ON|OFF")
		}
		state := "off"
		if *flag {
			state = "on"
		}
		fmt.Fprintf(s.Out, "%s is now %s.\n", name, state)
	default:
		return syntaxErr("usage: " + strings.ToUpper(name) + " ON|OFF")
	}
	return nil
}

func validLevel(v string, allowed []string) (string, bool) {
	v = strings.ToUpper(v)
	for _, l := range allowed {
		if l == v {
			return v, true
		}
	}
	return "", false
}

func (s *Shell) consistency(args []string) error {
	switch len(args) {
	case 0:
		fmt.Fprintf(s.Out, "Current consistency level is %s.\n", s.Consistency)
	case 1:
		l, ok := validLevel(args[0], consistencyLevels)
		if !ok {
			return syntaxErr("unknown consistency level " + args[0] + "; valid levels are " + strings.Join(consistencyLevels, ", "))
		}
		s.Consistency = l
		fmt.Fprintf(s.Out, "Consistency level set to %s.\n", l)
	default:
		return syntaxErr("usage: CONSISTENCY [level]")
	}
	return nil
}

func (s *Shell) serial(args []string) error {
	if len(args) == 0 || !strings.EqualFold(args[0], "CONSISTENCY") || len(args) > 2 {
		return syntaxErr("usage: SERIAL CONSISTENCY [SERIAL|LOCAL_SERIAL]")
	}
	if len(args) == 1 {
		fmt.Fprintf(s.Out, "Current serial consistency level is %s.\n", s.Serial)
		return nil
	}
	l, ok := validLevel(args[1], []string{"SERIAL", "LOCAL_SERIAL"})
	if !ok {
		return syntaxErr("serial consistency must be SERIAL or LOCAL_SERIAL")
	}
	s.Serial = l
	fmt.Fprintf(s.Out, "Serial consistency level set to %s.\n", l)
	return nil
}

func onOff(args []string, usage string) (on, show bool, err error) {
	if len(args) == 0 {
		return false, true, nil
	}
	if len(args) == 1 {
		switch strings.ToUpper(args[0]) {
		case "ON":
			return true, false, nil
		case "OFF":
			return false, false, nil
		}
	}
	return false, false, syntaxErr("usage: " + usage)
}

func (s *Shell) expand(args []string) error {
	on, show, err := onOff(args, "EXPAND ON|OFF")
	if err != nil {
		return err
	}
	switch {
	case show:
		if s.Format == "expanded" {
			fmt.Fprintln(s.Out, "Expanded output is ON.")
		} else {
			fmt.Fprintln(s.Out, "Expanded output is OFF.")
		}
	case on:
		s.Format = "expanded"
		fmt.Fprintln(s.Out, "Now printing expanded output.")
	default:
		s.Format = "table"
		fmt.Fprintln(s.Out, "Disabled expanded output.")
	}
	return nil
}

func (s *Shell) format(args []string) error {
	switch len(args) {
	case 0:
		fmt.Fprintf(s.Out, "Output format is %s.\n", s.Format)
	case 1:
		f := strings.ToLower(args[0])
		if f != "table" && f != "expanded" && f != "raw" {
			return syntaxErr("FORMAT must be table, expanded or raw")
		}
		s.Format = f
		fmt.Fprintf(s.Out, "Output format is %s.\n", f)
	default:
		return syntaxErr("usage: FORMAT table|expanded|raw")
	}
	return nil
}

func (s *Shell) paging(args []string) error {
	if len(args) == 0 {
		if s.Paging > 0 {
			fmt.Fprintf(s.Out, "Paging is ON (%d rows per page).\n", s.Paging)
		} else {
			fmt.Fprintln(s.Out, "Paging is OFF.")
		}
		return nil
	}
	if len(args) != 1 {
		return syntaxErr("usage: PAGING ON|OFF|<rows>")
	}
	switch a := strings.ToUpper(args[0]); a {
	case "ON":
		if s.Paging <= 0 {
			s.Paging = defaultPaging
		}
	case "OFF":
		s.Paging = 0
	default:
		n, err := strconv.Atoi(a)
		if err != nil || n < 0 {
			return syntaxErr("usage: PAGING ON|OFF|<rows>")
		}
		s.Paging = n
	}
	return s.paging(nil)
}

// maxSourceDepth stops SOURCE files that include themselves.
const maxSourceDepth = 10

func (s *Shell) source(ctx context.Context, line string) error {
	rest := strings.TrimSpace(line[len("SOURCE"):])
	rest = strings.TrimSuffix(rest, ";")
	rest = strings.TrimSpace(rest)
	if len(rest) >= 2 && (rest[0] == '\'' && rest[len(rest)-1] == '\'' || rest[0] == '"' && rest[len(rest)-1] == '"') {
		rest = rest[1 : len(rest)-1]
	}
	if rest == "" {
		return syntaxErr("usage: SOURCE '<file>'")
	}
	if s.sourceDepth >= maxSourceDepth {
		return errors.New("SOURCE nested too deeply")
	}
	b, err := os.ReadFile(expandHome(rest))
	if err != nil {
		return err
	}
	s.sourceDepth++
	defer func() { s.sourceDepth-- }()
	err = s.RunScript(ctx, rest, string(b), ScriptOptions{})
	if err != nil && !errors.Is(err, ErrExit) {
		// Errors were already printed by RunScript.
		return fmt.Errorf("%s: script stopped on an error", rest)
	}
	return err
}

func expandHome(p string) string {
	if strings.HasPrefix(p, "~/") {
		if h, err := os.UserHomeDir(); err == nil {
			return h + p[1:]
		}
	}
	return p
}

func (s *Shell) clear() {
	if s.Clear != nil {
		s.Clear()
		return
	}
	fmt.Fprint(s.Out, "\x1b[2J\x1b[H")
}

func (s *Shell) profile(ctx context.Context, args []string) error {
	if len(args) == 0 {
		if s.Profile == "" {
			fmt.Fprintln(s.Out, "No profile (connected with flags).")
		} else {
			fmt.Fprintf(s.Out, "Current profile is %s.\n", s.Profile)
		}
		return nil
	}
	if len(args) != 1 {
		return syntaxErr(`usage: \profile [name]`)
	}
	if s.Connect == nil {
		return errors.New(`\profile is not available here`)
	}
	b, err := s.Connect(ctx, args[0])
	if err != nil {
		return err
	}
	s.Backend = *b
	s.Profile = args[0]
	fmt.Fprintf(s.Out, "Connected to %s (Cassandra %s).\n", b.Cluster.Name, b.Cluster.ReleaseVersion)
	return nil
}
