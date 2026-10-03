package shell

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/exec"
	"github.com/0funct0ry/helenus/internal/trace"
)

var traceColumns = []exec.Column{
	{Name: "activity", Type: codec.TypeDesc{Name: "text"}},
	{Name: "timestamp", Type: codec.TypeDesc{Name: "text"}},
	{Name: "source", Type: codec.TypeDesc{Name: "text"}},
	{Name: "source_elapsed", Type: codec.TypeDesc{Name: "int"}},
}

// renderTrace prints a cqlsh-style trace: a header line followed by the events table.
func (s *Shell) renderTrace(tr *trace.Trace) {
	fmt.Fprintf(s.Out, "\n%s %s\n\n", paint(ansiHeader+"\x1b[1m", "Tracing session:", s.Styled), paint(ansiID, tr.ID, s.Styled))
	rows := make([][]Cell, len(tr.Events))
	for i, e := range tr.Events {
		ts := tr.StartedAt
		if !ts.IsZero() {
			ts = ts.Add(durationUS(e.ElapsedUS))
		}
		stamp := ""
		if !ts.IsZero() {
			stamp = ts.UTC().Format("15:04:05.000000")
		}
		rows[i] = []Cell{{Text: e.Activity}, {Text: stamp}, {Text: e.Source}, {Text: strconv.FormatInt(e.ElapsedUS, 10)}}
	}
	RenderTable(s.Out, traceColumns, rows, TableOptions{Width: s.width(), Styled: s.Styled})
	s.footer(fmt.Sprintf("(%d %s)", len(rows), plural1(len(rows), "event")))
	if s.Interactive {
		fmt.Fprintln(s.Out)
	}
}

// printTrace fetches and prints the trace for id, returning the coordinator
// duration in ms (nil when there is none). An unavailable trace is reported on
// stderr with the .show session hint.
func (s *Shell) printTrace(ctx context.Context, id string) *float64 {
	if id == "" || s.Tracer == nil {
		return nil
	}
	tr, err := s.Tracer(ctx, id)
	if err != nil {
		if errors.Is(err, trace.ErrNotAvailable) {
			fmt.Fprintf(s.Err, "Trace not yet available; try .show session %s\n", id)
		} else {
			fmt.Fprintf(s.Err, "Could not fetch trace %s: %v\n", id, err)
		}
		return nil
	}
	s.renderTrace(tr)
	ms := tr.Summary.CoordinatorMS
	return &ms
}

// showSession implements .show session <trace-id>.
func (s *Shell) showSession(ctx context.Context, args []string) error {
	if len(args) != 1 {
		return syntaxErr("usage: .show session <trace-id>")
	}
	if s.Tracer == nil {
		return errors.New("not connected")
	}
	tr, err := s.Tracer(ctx, args[0])
	if err != nil {
		if errors.Is(err, trace.ErrNotAvailable) {
			return fmt.Errorf("Trace %s not found or not yet available", args[0])
		}
		return err
	}
	s.renderTrace(tr)
	return nil
}

func durationUS(us int64) time.Duration { return time.Duration(us) * time.Microsecond }
