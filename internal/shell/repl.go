package shell

import (
	"context"
	"errors"
	"io"
	"os"
	"os/signal"
	"strings"

	"github.com/ergochat/readline"

	"github.com/0funct0ry/helenus/internal/cql"
)

// Run is the interactive loop. It reads statements with line editing until
// EXIT, QUIT, or Ctrl-D on an empty line. Statements may span lines: the
// splitter decides when one is complete.
func (s *Shell) Run(ctx context.Context) error {
	cfg := &readline.Config{
		Prompt:                 s.Prompt(),
		HistoryFile:            s.HistoryFile,
		HistoryLimit:           historyLimit(s.HistorySize),
		DisableAutoSaveHistory: true,
		VimMode:                s.ViMode,
		Stdin:                  s.In,
		Stdout:                 s.Out,
		Stderr:                 s.Err,
		AutoComplete:           completer{s},
	}
	if s.ReadlineConfig != nil {
		s.ReadlineConfig(cfg)
	}
	rl, err := readline.NewFromConfig(cfg)
	if err != nil {
		return err
	}
	defer rl.Close()

	s.Interactive = true
	s.Pause = func() bool {
		rl.SetPrompt("--More-- (Enter for the next page, q to stop) ")
		line, err := rl.Readline()
		return err == nil && !strings.EqualFold(strings.TrimSpace(line), "q")
	}
	defer func() { s.Pause = nil }()

	var lines []string
	defer func() { s.pending = nil }()
	for {
		s.pending = lines
		if len(lines) == 0 {
			rl.SetPrompt(s.Prompt())
		} else {
			rl.SetPrompt(ContinuationPrompt)
		}
		line, err := rl.Readline()
		if errors.Is(err, readline.ErrInterrupt) {
			lines = nil // Ctrl-C drops the statement being typed.
			continue
		}
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		if len(lines) == 0 && strings.TrimSpace(line) == "" {
			continue
		}
		lines = append(lines, line)
		input := strings.Join(lines, "\n")
		stmts := cql.Split(input)
		if n := len(stmts); n > 0 && !stmts[n-1].Complete {
			continue
		}
		lines = nil
		if len(stmts) == 0 {
			continue
		}
		if entry := historyEntry(input); entry != "" {
			_ = rl.SaveToHistory(entry)
		}
		if s.runLine(ctx, stmts) {
			return nil
		}
	}
}

// runLine executes the statements of one input and reports whether to exit.
// Ctrl-C while a statement runs cancels just that statement.
func (s *Shell) runLine(ctx context.Context, stmts []cql.Statement) (exit bool) {
	for _, st := range stmts {
		qctx, stop := signal.NotifyContext(ctx, os.Interrupt)
		err := s.Execute(qctx, st.Text)
		stop()
		if errors.Is(err, ErrExit) {
			return true
		}
		if err != nil {
			s.ReportError("", err)
			if errors.Is(err, context.Canceled) {
				break
			}
		}
	}
	return false
}

func historyLimit(n int) int {
	if n <= 0 {
		return 10000
	}
	return n
}

// historyEntry is what is saved for input: the lines joined into one entry,
// or "" when it must not be stored (statements containing PASSWORD).
func historyEntry(input string) string {
	if strings.Contains(strings.ToUpper(input), "PASSWORD") {
		return ""
	}
	fields := strings.Fields(strings.ReplaceAll(input, "\n", " "))
	return strings.Join(fields, " ")
}
