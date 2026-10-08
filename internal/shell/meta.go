package shell

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/0funct0ry/helenus/internal/config"
)

var consistencyLevels = []string{"ANY", "ONE", "TWO", "THREE", "QUORUM", "ALL", "LOCAL_QUORUM", "EACH_QUORUM", "SERIAL", "LOCAL_SERIAL", "LOCAL_ONE"}

const defaultPaging = 100

// syntaxErr is a malformed meta-command.
type syntaxErr string

func (e syntaxErr) Error() string { return "SyntaxError: " + string(e) }

// meta runs a meta-command. handled is false when the line is really CQL
// (anything that is not a dot command or an alias invocation falls through to the executor).
func (s *Shell) meta(ctx context.Context, line string) (handled bool, err error) {
	words := strings.Fields(line)
	cmd := strings.ToLower(words[0])
	args := words[1:]
	switch cmd {
	case ".exit", ".quit":
		return true, ErrExit
	case ".use":
		if len(args) != 1 {
			return true, syntaxErr("usage: .use <keyspace>")
		}
		return true, s.query(ctx, "USE "+args[0])
	case ".describe", ".desc":
		return true, s.describe(ctx, "DESCRIBE "+rawArgs(line))
	case ".tables", ".views", ".types", ".functions", ".aggregates", ".indexes", ".triggers":
		return true, s.listObjects(ctx, cmd, args)
	case ".show":
		return true, s.show(ctx, args)
	case ".consistency":
		return true, s.consistency(args)
	case ".serial":
		return true, s.serial(args)
	case ".expand":
		return true, s.expand(args)
	case ".format":
		return true, s.format(args)
	case ".paging":
		return true, s.paging(args)
	case ".source":
		return true, s.source(ctx, line)
	case ".save":
		return true, s.saveCmd(line)
	case ".open":
		return true, s.openCmd(ctx, line)
	case ".queries":
		return true, s.queriesCmd(line)
	case ".load":
		return true, s.loadCmd(ctx, line)
	case ".clear", ".cls":
		s.clear()
		return true, nil
	case ".help":
		s.help(args)
		return true, nil
	case ".profile":
		return true, s.profile(ctx, args)
	case ".tracing":
		return true, s.toggle("Tracing", &s.Tracing, args)
	case ".timing":
		return true, s.toggle("Timing", &s.Timing, args)
	case ".alias":
		return true, s.aliasCmd(line)
	case ".unalias":
		return true, s.unalias(line)
	case ".set":
		return true, s.setVar(line)
	case ".unset":
		return true, s.unsetVar(line)
	case ".abbrev":
		return true, s.abbrevCmd()
	}
	if strings.HasPrefix(cmd, ":") {
		return true, s.invokeAlias(ctx, line)
	}
	return true, syntaxErr("unknown command " + words[0] + "; .help lists the commands")
}

func (s *Shell) show(ctx context.Context, args []string) error {
	if len(args) >= 1 && strings.EqualFold(args[0], "SESSION") {
		return s.showSession(ctx, args[1:])
	}
	if len(args) == 1 && s.Cluster != nil {
		switch strings.ToUpper(args[0]) {
		case "VERSION":
			proto := s.Cluster.ProtocolVersion
			rows := [][]string{{"helenus", s.Version}, {"Cassandra", s.Cluster.ReleaseVersion}, {"CQL spec", s.Cluster.CQLVersion}}
			if proto != "" {
				rows = append(rows, []string{"Native protocol", "v" + strings.TrimPrefix(s.Cluster.ProtocolVersion, "v")})
			}
			s.printTable([]string{"component", "version"}, rows)
			return nil
		case "HOST":
			s.printTable([]string{"cluster", "host", "port"}, [][]string{{s.Cluster.Name, s.Host, strconv.Itoa(s.Port)}})
			return nil
		}
	}
	return syntaxErr(".show supports version, host and session <trace-id>")
}

// toggle implements .tracing and .timing: no argument shows the state.
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
			return syntaxErr("usage: ." + strings.ToLower(name) + " on|off")
		}
		state := "off"
		if *flag {
			state = "on"
		}
		fmt.Fprintf(s.Out, "%s is now %s.\n", name, state)
	default:
		return syntaxErr("usage: ." + strings.ToLower(name) + " on|off")
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
		return syntaxErr("usage: .consistency [level]")
	}
	return nil
}

func (s *Shell) serial(args []string) error {
	if len(args) == 0 || !strings.EqualFold(args[0], "CONSISTENCY") || len(args) > 2 {
		return syntaxErr("usage: .serial consistency [serial|local_serial]")
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
	on, show, err := onOff(args, ".expand on|off")
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
			return syntaxErr(".format must be table, expanded or raw")
		}
		s.Format = f
		fmt.Fprintf(s.Out, "Output format is %s.\n", f)
	default:
		return syntaxErr("usage: .format table|expanded|raw")
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
		return syntaxErr("usage: .paging on|off|<rows>")
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
			return syntaxErr("usage: .paging on|off|<rows>")
		}
		s.Paging = n
	}
	return s.paging(nil)
}

// maxSourceDepth stops .source files that include themselves.
const maxSourceDepth = 10

func (s *Shell) source(ctx context.Context, line string) error {
	rest := rawArgs(line)
	rest = strings.TrimSuffix(rest, ";")
	rest = strings.TrimSpace(rest)
	if len(rest) >= 2 && (rest[0] == '\'' && rest[len(rest)-1] == '\'' || rest[0] == '"' && rest[len(rest)-1] == '"') {
		rest = rest[1 : len(rest)-1]
	}
	if rest == "" {
		return syntaxErr("usage: .source '<file>'")
	}
	if s.sourceDepth >= maxSourceDepth {
		return errors.New(".source nested too deeply")
	}
	b, err := os.ReadFile(config.ExpandPath(rest))
	if err != nil {
		return err
	}
	return s.runFile(ctx, rest, string(b))
}

// runFile runs the statements of a file like .source: it stops at the first error.
func (s *Shell) runFile(ctx context.Context, name, text string) error {
	if s.sourceDepth >= maxSourceDepth {
		return errors.New(".source nested too deeply")
	}
	s.sourceDepth++
	defer func() { s.sourceDepth-- }()
	err := s.RunScript(ctx, name, text, ScriptOptions{})
	if err != nil && !errors.Is(err, ErrExit) {
		// Errors were already printed by RunScript.
		return fmt.Errorf("%s: script stopped on an error", name)
	}
	return err
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
		return syntaxErr(`usage: .profile [name]`)
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
