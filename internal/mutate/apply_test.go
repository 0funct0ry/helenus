package mutate

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/0funct0ry/helenus/internal/exec"
)

func stmts(n int) []Statement {
	out := make([]Statement, n)
	for i := range out {
		out[i] = Statement{Index: i, CQL: "stmt", Preview: "preview", Args: []any{i}}
	}
	return out
}

func TestApplyStopsAtFirstFailure(t *testing.T) {
	var seen []exec.Request
	run := func(_ context.Context, req exec.Request) (*exec.Result, error) {
		seen = append(seen, req)
		if len(seen) == 2 {
			return nil, errors.New("boom")
		}
		return &exec.Result{Kind: exec.KindVoid}, nil
	}
	out := Apply(context.Background(), run, stmts(4), Options{Consistency: "LOCAL_QUORUM", SerialConsistency: "SERIAL"})
	require.Len(t, seen, 2, "later statements must not run")
	require.Equal(t, "LOCAL_QUORUM", seen[0].Consistency)
	require.Equal(t, "SERIAL", seen[0].SerialConsistency)
	require.Equal(t, []any{0}, seen[0].Args)
	require.Equal(t, []string{StatusApplied, StatusFailed, StatusPending, StatusPending},
		[]string{out[0].Status, out[1].Status, out[2].Status, out[3].Status})
	require.EqualError(t, out[1].Err, "boom")
	require.Equal(t, "preview", out[2].ExecutedCQL)
}

func TestApplyTreatsDeclinedLWTAsFailure(t *testing.T) {
	run := func(_ context.Context, _ exec.Request) (*exec.Result, error) {
		return &exec.Result{
			Kind:    exec.KindRows,
			Columns: []exec.Column{{Name: "[applied]"}},
			Rows:    [][]any{{false}},
		}, nil
	}
	out := Apply(context.Background(), run, stmts(2), Options{})
	require.Equal(t, StatusFailed, out[0].Status)
	require.ErrorIs(t, out[0].Err, ErrNotApplied)
	require.Equal(t, StatusPending, out[1].Status)
}

func TestApplyAcceptsAppliedLWT(t *testing.T) {
	run := func(_ context.Context, _ exec.Request) (*exec.Result, error) {
		return &exec.Result{Kind: exec.KindRows, Columns: []exec.Column{{Name: "[applied]"}}, Rows: [][]any{{true}}}, nil
	}
	out := Apply(context.Background(), run, stmts(1), Options{})
	require.Equal(t, StatusApplied, out[0].Status)
}
