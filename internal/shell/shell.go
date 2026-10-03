package shell

import (
	"github.com/ergochat/readline"

	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/conn"
	"github.com/0funct0ry/helenus/internal/cql"
	"github.com/0funct0ry/helenus/internal/exec"
	"github.com/0funct0ry/helenus/internal/schema"
	"github.com/0funct0ry/helenus/internal/trace"
)

// Describer answers DESCRIBE statements. currentKS is the keyspace set by USE.
type Describer interface {
	Describe(ctx context.Context, t schema.Target, currentKS string) (string, error)
}

// Executor runs one statement and reads one page of rows. *exec.Executor
// implements it; tests substitute a fake.
type Executor interface {
	Run(ctx context.Context, req exec.Request) (*exec.Result, error)
}

// Backend is everything that belongs to one connection. \profile swaps it.
type Backend struct {
	Name      string
	Exec      Executor
	Describer Describer
	Cluster   *conn.ClusterInfo
	// Host and Port are the contact point shown by SHOW HOST.
	Host string
	Port int
	// Keyspace is the profile's initial keyspace.
	Keyspace string
	// Consistency and Serial are the profile's initial levels.
	Consistency string
	Serial      string
	// UDTFields resolves UDT field types for text rendering; may be nil.
	UDTFields func(codec.UDTRef) map[string]codec.TypeDesc
	// Tracer fetches a stored trace by id; nil disables trace printing.
	Tracer func(ctx context.Context, id string) (*trace.Trace, error)
	// Schema returns the cached schema snapshot for tab-completion; may be nil, in which case
	// only keywords are offered.
	Schema func(ctx context.Context) (*schema.Snapshot, error)
}

// ErrExit is returned by Execute when the user asked to leave the shell.
var ErrExit = errors.New("exit")

// ErrReported marks a failure whose message was already printed; callers only
// need its exit code.
var ErrReported = errors.New("error already reported")

// Shell is the CQL shell: meta-commands, statement execution and rendering.
// The interactive loop is Run (repl.go); RunScript runs -e, -f and SOURCE.
type Shell struct {
	In  io.Reader
	Out io.Writer
	Err io.Writer

	Backend
	// Connect opens another profile for \profile; nil disables switching.
	Connect func(ctx context.Context, name string) (*Backend, error)
	// Version is the helenus version shown by SHOW VERSION.
	Version string
	// Profile is the current profile name.
	Profile string

	// Session state, changed by meta-commands.
	Format string
	Paging int
	// Timing prints the client round-trip time to stderr after each statement.
	Timing bool
	// Tracing traces every statement and prints the trace after its results.
	Tracing bool

	// Terminal behavior.
	Interactive bool // a human is at the prompt: enables --More--
	Styled      bool // emit ANSI styling (bold/underline headers)
	Width       func() int
	// Pause asks whether to show the next page; nil never pauses.
	Pause func() bool
	// Clear clears the screen; nil prints the ANSI clear sequence.
	Clear func()

	// History and line editing (REPL only).
	HistoryFile string
	HistorySize int
	ViMode      bool
	// ReadlineConfig lets tests adjust the readline config (for example to run
	// the editor over pipes instead of a terminal).
	ReadlineConfig func(*readline.Config)

	sourceDepth int
	// pending holds the earlier lines of the statement being typed, for tab-completion.
	pending []string
}

// Prompt returns the primary prompt for the current keyspace.
func (s *Shell) Prompt() string {
	if s.Keyspace == "" {
		return "helenus> "
	}
	return "helenus:" + s.Keyspace + "> "
}

// ContinuationPrompt is shown while a statement is incomplete.
const ContinuationPrompt = "           ...> "

func (s *Shell) width() int {
	if s.Width == nil {
		return 0
	}
	return s.Width()
}

// Execute runs one statement or meta-command. It returns ErrExit for EXIT and
// QUIT, and any other error after the caller decides how to report it.
func (s *Shell) Execute(ctx context.Context, text string) error {
	stmt := strings.TrimSpace(text)
	body := strings.TrimSpace(strings.TrimSuffix(stmt, ";"))
	if body == "" {
		return nil
	}
	if cql.IsMetaStart(body) {
		if handled, err := s.meta(ctx, body); handled {
			return err
		}
	}
	return s.query(ctx, stmt)
}

// query sends a CQL statement and prints its rows, page by page.
func (s *Shell) query(ctx context.Context, stmt string) error {
	if s.Exec == nil {
		return errors.New("not connected")
	}
	req := exec.Request{
		CQL: stmt, Keyspace: s.Keyspace,
		Consistency: s.Consistency, SerialConsistency: s.Serial,
		PageSize: s.Paging, Trace: s.Tracing,
	}
	type page struct {
		ms      float64
		traceID string
	}
	var pages []page
	total := 0
	first := true
	sawRows := false
	var started time.Time
	for {
		started = time.Now()
		res, err := s.Exec.Run(ctx, req)
		if err != nil {
			return err
		}
		if res.KeyspaceAfter != "" {
			s.Keyspace = res.KeyspaceAfter
		}
		for _, w := range res.Warnings {
			fmt.Fprintf(s.Err, "Warning: %s\n", w)
		}
		if res.Kind == exec.KindRows {
			sawRows = true
			rows := s.cells(res)
			s.render(res, rows, total, first)
			total += len(rows)
		}
		ms := res.Timing.ClientMS
		if ms == 0 {
			ms = float64(time.Since(started).Microseconds()) / 1000
		}
		pages = append(pages, page{ms, res.TraceID})
		first = false
		if !res.HasMore {
			break
		}
		if s.Paging > 0 && s.Pause != nil && !s.Pause() {
			break
		}
		ps, err := base64.StdEncoding.DecodeString(res.PageState)
		if err != nil {
			return fmt.Errorf("bad page state: %w", err)
		}
		req.PageState = ps
	}
	if sawRows && s.Format != "raw" {
		fmt.Fprintf(s.Out, "\n(%d %s)\n", total, plural1(total, "row"))
		if s.Interactive {
			fmt.Fprintln(s.Out)
		}
	}
	for _, p := range pages {
		coordinator := s.printTrace(ctx, p.traceID)
		if s.Timing {
			s.printTiming(p.ms, coordinator)
		}
	}
	return nil
}

// printTiming writes the Time line to stderr. coordinator is nil without a trace.
func (s *Shell) printTiming(clientMS float64, coordinator *float64) {
	if coordinator != nil {
		fmt.Fprintf(s.Err, "Time: %.1f ms (coordinator %.1f ms)\n", clientMS, *coordinator)
		return
	}
	fmt.Fprintf(s.Err, "Time: %.1f ms\n", clientMS)
}

func plural1(n int, word string) string {
	if n == 1 {
		return word
	}
	return word + "s"
}
