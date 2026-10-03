package trace

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeSource struct {
	sess  *SessionRow
	ev    []EventRow
	calls int
	// readyAfter is the number of Session calls before the duration is set.
	readyAfter int
}

func (f *fakeSource) Session(context.Context, string) (*SessionRow, error) {
	f.calls++
	if f.sess == nil {
		return nil, nil
	}
	s := *f.sess
	if f.calls <= f.readyAfter {
		s.DurationUS = 0
	}
	return &s, nil
}

func (f *fakeSource) Events(context.Context, string) ([]EventRow, error) { return f.ev, nil }

var sampleSession = &SessionRow{Coordinator: "10.0.0.1", Request: "Execute CQL3 query", DurationUS: 31702}

var sampleEvents = []EventRow{
	{Activity: "Merged data from memtables and 2 sstables", Source: "10.0.0.3", ElapsedUS: 18390, Thread: "ReadStage-2"},
	{Activity: "Parsing SELECT", Source: "10.0.0.1", ElapsedUS: 412, Thread: "Native-Transport-Requests-4"},
	{Activity: "READ message received", Source: "10.0.0.3", ElapsedUS: 7004, Thread: "MessagingService-Inbound"},
	{Activity: "READ message received", Source: "10.0.0.2", ElapsedUS: 6500, Thread: "MessagingService-Inbound"},
	{Activity: "Request complete", Source: "10.0.0.1", ElapsedUS: 31702, Thread: "Native-Transport-Requests-4"},
}

func TestShapeLanes(t *testing.T) {
	tr := Shape("id", sampleSession, sampleEvents)
	if len(tr.Lanes) != 3 {
		t.Fatalf("lanes = %d, want 3", len(tr.Lanes))
	}
	if tr.Lanes[0].Node != "10.0.0.1" || tr.Lanes[0].Role != "coordinator" {
		t.Errorf("first lane = %+v, want coordinator 10.0.0.1", tr.Lanes[0])
	}
	if tr.Lanes[1].Role != "replica" || tr.Lanes[2].Role != "replica" {
		t.Errorf("replica roles wrong: %+v", tr.Lanes)
	}
	if got := tr.Summary; got.ReplicasContacted != 2 || got.EventCount != 5 || got.NodeCount != 3 || got.CoordinatorMS != 31.702 {
		t.Errorf("summary = %+v", got)
	}
	for i := 1; i < len(tr.Events); i++ {
		if tr.Events[i].ElapsedUS < tr.Events[i-1].ElapsedUS {
			t.Fatalf("events not ordered by elapsed: %+v", tr.Events)
		}
	}
	bars := tr.Lanes[0].Bars
	if len(bars) != 2 || bars[0].StartUS != 412 || bars[0].EndUS != 31702 || bars[1].StartUS != bars[1].EndUS {
		t.Errorf("coordinator bars = %+v", bars)
	}
}

func TestShapeCoordinatorWithoutEvents(t *testing.T) {
	tr := Shape("id", sampleSession, []EventRow{{Activity: "x", Source: "10.0.0.2", ElapsedUS: 5}})
	if len(tr.Lanes) != 2 || tr.Lanes[0].Node != "10.0.0.1" || len(tr.Lanes[0].Bars) != 0 {
		t.Errorf("lanes = %+v", tr.Lanes)
	}
}

func TestFetchPollsUntilDuration(t *testing.T) {
	src := &fakeSource{sess: sampleSession, ev: sampleEvents, readyAfter: 2}
	tr, err := Fetch(context.Background(), src, "id", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if src.calls != 3 || tr.DurationUS != 31702 {
		t.Errorf("calls = %d, trace = %+v", src.calls, tr)
	}
}

func TestFetchNotAvailable(t *testing.T) {
	for name, src := range map[string]*fakeSource{
		"missing session": {},
		"never finished":  {sess: sampleSession, readyAfter: 1 << 20},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := Fetch(context.Background(), src, "id", 250*time.Millisecond)
			if !errors.Is(err, ErrNotAvailable) {
				t.Errorf("err = %v, want ErrNotAvailable", err)
			}
		})
	}
}

func TestFetchContextCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := Fetch(ctx, &fakeSource{}, "id", time.Second)
	if !errors.Is(err, context.Canceled) {
		t.Errorf("err = %v, want context.Canceled", err)
	}
}
