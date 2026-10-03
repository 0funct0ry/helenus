// Package trace reads Cassandra query traces from system_traces and shapes them
// for the shell and the web UI (SPEC §9.12). It knows nothing of HTTP or terminals.
package trace

import (
	"context"
	"errors"
	"sort"
	"time"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
)

// PollWindow is how long Fetch waits for Cassandra to finish writing a trace.
// Traces are written asynchronously (SPEC §9.12).
const PollWindow = 2 * time.Second

const pollInterval = 100 * time.Millisecond

// ErrNotAvailable means the trace session was not (completely) written within the poll window.
var ErrNotAvailable = errors.New("trace not yet available")

// SessionRow is one row of system_traces.sessions.
type SessionRow struct {
	Coordinator string
	Request     string
	DurationUS  int64
	StartedAt   time.Time
	Parameters  map[string]string
}

// EventRow is one row of system_traces.events.
type EventRow struct {
	Activity  string
	Source    string
	ElapsedUS int64
	Thread    string
}

// Source reads raw trace rows. gocql sessions implement it through NewSource;
// tests substitute a fake.
type Source interface {
	// Session returns the session row, or nil when it does not exist yet.
	Session(ctx context.Context, id string) (*SessionRow, error)
	Events(ctx context.Context, id string) ([]EventRow, error)
}

// Event is one shaped trace event.
type Event struct {
	Activity  string `json:"activity"`
	Source    string `json:"source"`
	ElapsedUS int64  `json:"elapsed_us"`
	Thread    string `json:"thread"`
	// TimestampMS is the event's offset from the session start, in ms.
	TimestampMS float64 `json:"timestamp_ms"`
}

// Bar is one span in a node lane, between two consecutive events on that node.
type Bar struct {
	StartUS int64  `json:"start_us"`
	EndUS   int64  `json:"end_us"`
	Label   string `json:"label"`
}

// Lane groups the events of one node.
type Lane struct {
	Node string `json:"node"`
	// Role is "coordinator" or "replica".
	Role string `json:"role"`
	Bars []Bar  `json:"bars"`
}

// Summary holds the headline figures.
type Summary struct {
	Coordinator       string  `json:"coordinator"`
	Request           string  `json:"request"`
	CoordinatorMS     float64 `json:"coordinator_ms"`
	ReplicasContacted int     `json:"replicas_contacted"`
	EventCount        int     `json:"event_count"`
	NodeCount         int     `json:"node_count"`
}

// Trace is a shaped trace session.
type Trace struct {
	ID         string            `json:"id"`
	StartedAt  time.Time         `json:"started_at"`
	DurationUS int64             `json:"duration_us"`
	Parameters map[string]string `json:"parameters,omitempty"`
	Summary    Summary           `json:"summary"`
	Lanes      []Lane            `json:"lanes"`
	Events     []Event           `json:"events"`
}

// Fetch polls src for the trace until the session has a duration (Cassandra's
// "finished" marker) or wait elapses, then returns the shaped trace.
// It returns ErrNotAvailable when the trace is still incomplete.
func Fetch(ctx context.Context, src Source, id string, wait time.Duration) (*Trace, error) {
	deadline := time.Now().Add(wait)
	for {
		s, err := src.Session(ctx, id)
		if err != nil {
			return nil, err
		}
		if s != nil && s.DurationUS > 0 {
			ev, err := src.Events(ctx, id)
			if err != nil {
				return nil, err
			}
			return Shape(id, s, ev), nil
		}
		if !time.Now().Before(deadline) {
			return nil, ErrNotAvailable
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(pollInterval):
		}
	}
}

// Shape turns raw rows into a Trace: events ordered by node then elapsed time
// for the lanes, and by elapsed time for the table. source_elapsed is measured
// on each node's own clock, as in cqlsh.
func Shape(id string, s *SessionRow, rows []EventRow) *Trace {
	events := make([]Event, len(rows))
	for i, r := range rows {
		events[i] = Event{Activity: r.Activity, Source: r.Source, ElapsedUS: r.ElapsedUS, Thread: r.Thread, TimestampMS: float64(r.ElapsedUS) / 1000}
	}
	sort.SliceStable(events, func(i, j int) bool { return events[i].ElapsedUS < events[j].ElapsedUS })

	byNode := map[string][]Event{}
	var order []string
	for _, e := range events {
		if _, ok := byNode[e.Source]; !ok {
			order = append(order, e.Source)
		}
		byNode[e.Source] = append(byNode[e.Source], e)
	}
	// Coordinator first, then replicas in the order they first appear.
	sort.SliceStable(order, func(i, j int) bool { return order[i] == s.Coordinator && order[j] != s.Coordinator })
	if _, ok := byNode[s.Coordinator]; !ok && s.Coordinator != "" {
		order = append([]string{s.Coordinator}, order...)
	}

	lanes := make([]Lane, 0, len(order))
	replicas := 0
	for _, n := range order {
		role := "replica"
		if n == s.Coordinator {
			role = "coordinator"
		} else {
			replicas++
		}
		evs := byNode[n]
		l := Lane{Node: n, Role: role, Bars: []Bar{}}
		for i, e := range evs {
			end := e.ElapsedUS
			if i+1 < len(evs) {
				end = evs[i+1].ElapsedUS
			}
			l.Bars = append(l.Bars, Bar{StartUS: e.ElapsedUS, EndUS: end, Label: e.Activity})
		}
		lanes = append(lanes, l)
	}
	return &Trace{
		ID: id, StartedAt: s.StartedAt, DurationUS: s.DurationUS, Parameters: s.Parameters,
		Lanes: lanes, Events: events,
		Summary: Summary{
			Coordinator: s.Coordinator, Request: s.Request,
			CoordinatorMS:     float64(s.DurationUS) / 1000,
			ReplicasContacted: replicas, EventCount: len(events), NodeCount: len(lanes),
		},
	}
}

type gocqlSource struct{ sess *gocql.Session }

// NewSource reads traces through a gocql session.
func NewSource(sess *gocql.Session) Source { return gocqlSource{sess} }

func (g gocqlSource) Session(ctx context.Context, id string) (*SessionRow, error) {
	uid, err := gocql.ParseUUID(id)
	if err != nil {
		return nil, err
	}
	var (
		coord  string
		req    string
		dur    *int
		start  time.Time
		params map[string]string
	)
	err = g.sess.Query("SELECT coordinator, request, duration, started_at, parameters FROM system_traces.sessions WHERE session_id = ?", uid).
		ScanContext(ctx, &coord, &req, &dur, &start, &params)
	if errors.Is(err, gocql.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	row := &SessionRow{Coordinator: coord, Request: req, StartedAt: start, Parameters: params}
	if dur != nil {
		row.DurationUS = int64(*dur)
	}
	return row, nil
}

func (g gocqlSource) Events(ctx context.Context, id string) ([]EventRow, error) {
	uid, err := gocql.ParseUUID(id)
	if err != nil {
		return nil, err
	}
	it := g.sess.Query("SELECT activity, source, source_elapsed, thread FROM system_traces.events WHERE session_id = ?", uid).IterContext(ctx)
	var out []EventRow
	var (
		act, src, thread string
		el               *int
	)
	for it.Scan(&act, &src, &el, &thread) {
		r := EventRow{Activity: act, Source: src, Thread: thread}
		if el != nil {
			r.ElapsedUS = int64(*el)
		}
		out = append(out, r)
	}
	return out, it.Close()
}
