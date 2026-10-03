package mutate

import (
	"context"
	"errors"

	"github.com/0funct0ry/helenus/internal/exec"
)

// Statuses of an applied change.
const (
	StatusApplied = "applied"
	StatusFailed  = "failed"
	StatusPending = "pending"
)

// ErrNotApplied is returned for a conditional insert whose row already exists.
var ErrNotApplied = errors.New("not applied: a row with this primary key already exists")

// RunFunc executes one statement. exec.Executor.Run satisfies it.
type RunFunc func(ctx context.Context, req exec.Request) (*exec.Result, error)

// Options carries the consistency settings applied to every statement.
type Options struct {
	Consistency       string
	SerialConsistency string
}

// Outcome is the result of one change.
type Outcome struct {
	Index       int
	Status      string
	Err         error
	ExecutedCQL string
}

// Apply runs stmts in order, one prepared statement each and never in a logged
// batch (SPEC §9.9). It stops at the first failure; later changes are reported
// as pending so the caller can leave them staged.
func Apply(ctx context.Context, run RunFunc, stmts []Statement, opts Options) []Outcome {
	out := make([]Outcome, len(stmts))
	failed := false
	for i, st := range stmts {
		out[i] = Outcome{Index: st.Index, Status: StatusPending, ExecutedCQL: st.Preview}
		if failed {
			continue
		}
		res, err := run(ctx, exec.Request{
			CQL:               st.CQL,
			Consistency:       opts.Consistency,
			SerialConsistency: opts.SerialConsistency,
			Args:              st.Args,
		})
		if err == nil && notApplied(res) {
			err = ErrNotApplied
		}
		if err != nil {
			out[i].Status, out[i].Err = StatusFailed, err
			failed = true
			continue
		}
		out[i].Status = StatusApplied
	}
	return out
}

// notApplied reports a lightweight transaction that Cassandra declined.
func notApplied(res *exec.Result) bool {
	if res == nil || len(res.Columns) == 0 || res.Columns[0].Name != "[applied]" || len(res.Rows) == 0 {
		return false
	}
	applied, ok := res.Rows[0][0].(bool)
	return ok && !applied
}
