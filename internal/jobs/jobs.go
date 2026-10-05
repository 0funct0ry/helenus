// Package jobs is the in-memory registry of background jobs (seed runs now,
// export and import later). Jobs live only as long as the `helenus ui` process.
package jobs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sort"
	"sync"
	"time"
)

// States a job moves through.
const (
	Running   = "running"
	Done      = "done"
	Failed    = "failed"
	Cancelled = "cancelled"
)

// Progress is a point-in-time view of how far a job is.
type Progress struct {
	Done     int64   `json:"done"`
	Total    int64   `json:"total"`
	Errors   int64   `json:"errors"`
	RatePerS float64 `json:"rate_per_s"`
	EtaS     float64 `json:"eta_s"`
}

// Job is the JSON shape served by the jobs API.
type Job struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	Profile   string    `json:"profile"`
	State     string    `json:"state"`
	Progress  Progress  `json:"progress"`
	StartedAt time.Time `json:"started_at"`
	EndedAt   time.Time `json:"ended_at,omitempty"`
	Result    any       `json:"result,omitempty"`
}

type entry struct {
	job    Job
	cancel context.CancelFunc
	// firstErrors is surfaced through Result by the job function itself.
}

// Registry holds the jobs of one process.
type Registry struct {
	mu   sync.Mutex
	jobs map[string]*entry
	now  func() time.Time
}

// New returns an empty registry.
func New() *Registry { return &Registry{jobs: map[string]*entry{}, now: time.Now} }

// Reporter lets a running job publish progress and its result.
type Reporter struct {
	r  *Registry
	id string
}

// Update replaces the job's counters; rate and ETA are derived from elapsed time.
func (p *Reporter) Update(done, total, errs int64) {
	p.r.mu.Lock()
	defer p.r.mu.Unlock()
	e := p.r.jobs[p.id]
	if e == nil {
		return
	}
	e.job.Progress = progress(done, total, errs, p.r.now().Sub(e.job.StartedAt))
}

// SetResult stores the value served as the job's result.
func (p *Reporter) SetResult(v any) {
	p.r.mu.Lock()
	defer p.r.mu.Unlock()
	if e := p.r.jobs[p.id]; e != nil {
		e.job.Result = v
	}
}

func progress(done, total, errs int64, elapsed time.Duration) Progress {
	p := Progress{Done: done, Total: total, Errors: errs}
	if s := elapsed.Seconds(); s > 0 {
		p.RatePerS = float64(done) / s
	}
	if p.RatePerS > 0 && total > done {
		p.EtaS = float64(total-done) / p.RatePerS
	}
	return p
}

// Start runs fn in a goroutine. fn returns nil for done, an error for failed;
// a cancelled context always ends as cancelled.
func (r *Registry) Start(kind, profile string, fn func(ctx context.Context, p *Reporter) error) Job {
	ctx, cancel := context.WithCancel(context.Background())
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	id := hex.EncodeToString(b)
	e := &entry{cancel: cancel, job: Job{ID: id, Kind: kind, Profile: profile, State: Running, StartedAt: r.now()}}
	r.mu.Lock()
	r.jobs[id] = e
	snap := e.job
	r.mu.Unlock()
	go func() {
		err := fn(ctx, &Reporter{r: r, id: id})
		r.mu.Lock()
		defer r.mu.Unlock()
		switch {
		case ctx.Err() != nil:
			e.job.State = Cancelled
		case err != nil:
			e.job.State = Failed
			if e.job.Result == nil {
				e.job.Result = map[string]string{"error": err.Error()}
			}
		default:
			e.job.State = Done
		}
		e.job.EndedAt = r.now()
		cancel()
	}()
	return snap
}

// Get returns the job with id for profile.
func (r *Registry) Get(profile, id string) (Job, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	e := r.jobs[id]
	if e == nil || e.job.Profile != profile {
		return Job{}, false
	}
	return e.job, true
}

// List returns the profile's jobs, newest first.
func (r *Registry) List(profile string) []Job {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []Job{}
	for _, e := range r.jobs {
		if e.job.Profile == profile {
			out = append(out, e.job)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt.After(out[j].StartedAt) })
	return out
}

// Cancel asks a running job to stop; it reports whether the job exists.
func (r *Registry) Cancel(profile, id string) bool {
	r.mu.Lock()
	e := r.jobs[id]
	r.mu.Unlock()
	if e == nil || e.job.Profile != profile {
		return false
	}
	e.cancel()
	return true
}
