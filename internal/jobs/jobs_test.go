package jobs

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func wait(t *testing.T, r *Registry, id string, want string) Job {
	t.Helper()
	for i := 0; i < 200; i++ {
		if j, _ := r.Get("p", id); j.State == want {
			return j
		}
		time.Sleep(10 * time.Millisecond)
	}
	j, _ := r.Get("p", id)
	t.Fatalf("job state = %s, want %s", j.State, want)
	return j
}

func TestLifecycle(t *testing.T) {
	r := New()
	j := r.Start("seed", "p", func(ctx context.Context, p *Reporter) error {
		p.Update(5, 10, 1)
		p.SetResult("ok")
		return nil
	})
	got := wait(t, r, j.ID, Done)
	if got.Progress.Done != 5 || got.Progress.Total != 10 || got.Progress.Errors != 1 || got.Result != "ok" {
		t.Fatalf("unexpected job %+v", got)
	}
	if _, ok := r.Get("other", j.ID); ok {
		t.Fatal("job visible from another profile")
	}
}

func TestFailedAndCancel(t *testing.T) {
	r := New()
	f := r.Start("seed", "p", func(context.Context, *Reporter) error { return errors.New("boom") })
	wait(t, r, f.ID, Failed)
	c := r.Start("seed", "p", func(ctx context.Context, _ *Reporter) error { <-ctx.Done(); return ctx.Err() })
	if !r.Cancel("p", c.ID) {
		t.Fatal("cancel reported missing job")
	}
	wait(t, r, c.ID, Cancelled)
	if r.Cancel("p", "nope") {
		t.Fatal("cancel of unknown job succeeded")
	}
	if len(r.List("p")) != 2 {
		t.Fatalf("list = %d", len(r.List("p")))
	}
}

func TestProgressMath(t *testing.T) {
	p := progress(50, 100, 0, 5*time.Second)
	if p.RatePerS != 10 || p.EtaS != 5 {
		t.Fatalf("progress = %+v", p)
	}
}

func TestConcurrentUpdates(t *testing.T) {
	r := New()
	j := r.Start("seed", "p", func(ctx context.Context, p *Reporter) error {
		var wg sync.WaitGroup
		for i := 0; i < 8; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				for k := 0; k < 100; k++ {
					p.Update(int64(k), 100, 0)
					r.Get("p", "x")
				}
			}(i)
		}
		wg.Wait()
		return nil
	})
	wait(t, r, j.ID, Done)
}
