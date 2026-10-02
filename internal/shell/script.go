package shell

import (
	"context"
	"errors"
	"fmt"

	"github.com/0funct0ry/helenus/internal/cli"
	"github.com/0funct0ry/helenus/internal/cql"
	"github.com/0funct0ry/helenus/internal/exec"
)

// ScriptOptions controls RunScript (SPEC §8.6).
type ScriptOptions struct {
	// Echo prints each statement to stdout before running it (-E).
	Echo bool
	// ContinueOnError keeps going after a failing statement (-x).
	ContinueOnError bool
	// AbortCode is the exit code when the run stops at a failure: 4 for -f
	// (script aborted), 1 for -e (the CQL error itself).
	AbortCode int
}

// ReportError prints a failed statement to stderr. where is "" or "file:line".
func (s *Shell) ReportError(where string, err error) {
	prefix := ""
	if where != "" {
		prefix = where + ": "
	}
	var syn syntaxErr
	switch {
	case errors.As(err, &syn):
		fmt.Fprintf(s.Err, "%s%v\n", prefix, err)
	case errors.Is(err, context.Canceled):
		fmt.Fprintf(s.Err, "%sCancelled.\n", prefix)
	default:
		fmt.Fprintf(s.Err, "%sError: %v\n", prefix, err)
	}
	var f *exec.ErrFilteringRequired
	if errors.As(err, &f) {
		fmt.Fprintln(s.Err, "Hint: this query needs filtering. Append ALLOW FILTERING to the statement and run it again, accepting that it may scan a lot of data.")
	}
}

// RunScript runs every statement of input through the splitter. Results go to
// stdout and errors to stderr. name labels errors ("" for -e). A statement
// without a closing semicolon at the end of the input is still run.
//
// It returns nil on success. On failure it returns a *cli.ExitError wrapping
// ErrReported (the messages were already printed): AbortCode when it stopped
// at the first failure, or 1 when ContinueOnError let it finish with failures.
func (s *Shell) RunScript(ctx context.Context, name, input string, o ScriptOptions) error {
	if o.AbortCode == 0 {
		o.AbortCode = cli.ExitScript
	}
	failed := 0
	for _, st := range cql.Split(input) {
		if err := ctx.Err(); err != nil {
			return &cli.ExitError{Code: o.AbortCode, Err: ErrReported}
		}
		if o.Echo {
			fmt.Fprintln(s.Out, st.Text)
		}
		err := s.Execute(ctx, st.Text)
		if errors.Is(err, ErrExit) {
			return nil
		}
		if err == nil {
			continue
		}
		where := ""
		if name != "" {
			where = fmt.Sprintf("%s:%d", name, st.Line)
		}
		s.ReportError(where, err)
		failed++
		if !o.ContinueOnError {
			return &cli.ExitError{Code: o.AbortCode, Err: ErrReported}
		}
	}
	if failed > 0 {
		return &cli.ExitError{Code: cli.ExitCQL, Err: fmt.Errorf("%d %s failed: %w", failed, plural1(failed, "statement"), ErrReported)}
	}
	return nil
}
