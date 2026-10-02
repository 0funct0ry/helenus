package shell

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/0funct0ry/helenus/internal/conn"
	"github.com/0funct0ry/helenus/internal/schema"
)

// Describer answers DESCRIBE statements. currentKS is the keyspace set by USE ("" until M4 adds USE).
type Describer interface {
	Describe(ctx context.Context, t schema.Target, currentKS string) (string, error)
}

// Shell is the line-oriented prompt. Until M4 it understands DESCRIBE, SHOW VERSION, SHOW HOST, EXIT and QUIT.
type Shell struct {
	In  io.Reader
	Out io.Writer
	Err io.Writer
	// Describer backs DESCRIBE.
	Describer Describer
	Cluster   *conn.ClusterInfo
	// Version is the helenus version shown by SHOW VERSION.
	Version string
	// Host and Port are the contact point shown by SHOW HOST.
	Host string
	Port int
	// Keyspace is the current keyspace, if any.
	Keyspace string
}

// Run reads statements until EXIT, QUIT or end of input.
func (s *Shell) Run(ctx context.Context) {
	sc := bufio.NewScanner(s.In)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for {
		fmt.Fprint(s.Out, "helenus> ")
		if !sc.Scan() {
			fmt.Fprintln(s.Out)
			return
		}
		if !s.Exec(ctx, sc.Text()) {
			return
		}
	}
}

// Exec runs one line and reports whether the shell should keep going.
func (s *Shell) Exec(ctx context.Context, line string) bool {
	stmt := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(line), ";"))
	words := strings.Fields(stmt)
	if len(words) == 0 {
		return true
	}
	switch strings.ToUpper(words[0]) {
	case "EXIT", "QUIT":
		return false
	case "DESCRIBE", "DESC":
		s.describe(ctx, stmt)
	case "SHOW":
		s.show(words[1:])
	default:
		fmt.Fprintln(s.Out, "not implemented yet (planned for M4); try DESCRIBE, SHOW VERSION, SHOW HOST or EXIT")
	}
	return true
}

func (s *Shell) describe(ctx context.Context, stmt string) {
	t, err := schema.ParseDescribe(stmt)
	if err != nil {
		fmt.Fprintf(s.Err, "SyntaxError: %v\n", err)
		return
	}
	out, err := s.Describer.Describe(ctx, t, s.Keyspace)
	if err != nil {
		fmt.Fprintf(s.Err, "Error: %v\n", err)
		return
	}
	fmt.Fprint(s.Out, out)
}

func (s *Shell) show(args []string) {
	if len(args) == 1 {
		switch strings.ToUpper(args[0]) {
		case "VERSION":
			proto := ""
			if p := s.Cluster.ProtocolVersion; p != "" {
				proto = " | Native protocol v" + strings.TrimPrefix(p, "v")
			}
			fmt.Fprintf(s.Out, "[helenus %s | Cassandra %s | CQL spec %s%s]\n", s.Version, s.Cluster.ReleaseVersion, s.Cluster.CQLVersion, proto)
			return
		case "HOST":
			fmt.Fprintf(s.Out, "Connected to %s at %s:%d\n", s.Cluster.Name, s.Host, s.Port)
			return
		}
	}
	fmt.Fprintln(s.Err, "SyntaxError: SHOW supports VERSION and HOST")
}
