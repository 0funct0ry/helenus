package export

import (
	"context"
	"errors"
	"fmt"
	"math"
	"math/big"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/cql"
	"github.com/0funct0ry/helenus/internal/exec"
)

// Runner reads one page of a statement; *exec.Executor and the server's
// connector adapter implement it. Masking of credential columns happens there.
type Runner interface {
	Run(ctx context.Context, req exec.Request) (*exec.Result, error)
}

// Source is what to export: a table (optionally narrowed) or a query.
type Source struct {
	Keyspace string   `json:"keyspace"`
	Table    string   `json:"table"`
	Columns  []string `json:"columns"`
	// Where is passed through after WHERE; the server validates it by running it.
	Where string `json:"where"`
	// Query is a SELECT statement; it takes precedence over Keyspace/Table.
	Query string `json:"query"`
	// PartitionKey names the partition key columns; required for token-range splits.
	PartitionKey []string `json:"-"`
}

// Config tunes the read side of an export.
type Config struct {
	PageSize    int
	Consistency string
	// RowsPerSecond throttles writing; 0 is unlimited.
	RowsPerSecond int
	// Ranges splits a whole-table export into this many token ranges (1–64).
	Ranges int
	// Concurrency bounds parallel range reads; it never exceeds Ranges.
	Concurrency int
	// Progress is called after each page with the rows written so far.
	Progress func(rows int64)
}

// MaxRanges is the largest token-range split.
const MaxRanges = 64

// Statement builds the SELECT for a table source.
func (s Source) Statement() string {
	if q := strings.TrimSpace(s.Query); q != "" {
		return strings.TrimSuffix(q, ";")
	}
	cols := "*"
	if len(s.Columns) > 0 {
		q := make([]string, len(s.Columns))
		for i, c := range s.Columns {
			q[i] = cql.QuoteIdent(c)
		}
		cols = strings.Join(q, ", ")
	}
	st := "SELECT " + cols + " FROM " + cql.QuoteIdent(s.Keyspace) + "." + cql.QuoteIdent(s.Table)
	if w := strings.TrimSpace(s.Where); w != "" {
		st += " WHERE " + w
	}
	return st
}

// TokenRanges splits the full token space into n inclusive ranges.
func TokenRanges(n int) [][2]int64 {
	if n < 1 {
		n = 1
	}
	lo := big.NewInt(math.MinInt64)
	span := new(big.Int).Sub(big.NewInt(math.MaxInt64), lo)
	span.Add(span, big.NewInt(1)) // 2^64 tokens
	out := make([][2]int64, 0, n)
	prev := new(big.Int).Set(lo)
	for i := 1; i <= n; i++ {
		var end *big.Int
		if i == n {
			end = big.NewInt(math.MaxInt64)
		} else {
			end = new(big.Int).Mul(span, big.NewInt(int64(i)))
			end.Div(end, big.NewInt(int64(n)))
			end.Add(end, lo)
			end.Sub(end, big.NewInt(1))
		}
		out = append(out, [2]int64{prev.Int64(), end.Int64()})
		prev = new(big.Int).Add(end, big.NewInt(1))
	}
	return out
}

type batch struct {
	cols []exec.Column
	rows [][]any
}

// Run exports src into w and returns the number of rows written. Pages are
// streamed to w as they arrive; on error or cancellation the caller discards
// the output. w.End is called only on success.
func Run(ctx context.Context, r Runner, src Source, cfg Config, w Writer) (int64, error) {
	if cfg.PageSize <= 0 {
		cfg.PageSize = 1000
	}
	stmt := src.Statement()
	type job struct {
		cql  string
		args []any
	}
	jobs := []job{{cql: stmt}}
	if cfg.Ranges > 1 {
		if strings.TrimSpace(src.Query) != "" || strings.TrimSpace(src.Where) != "" || src.Table == "" {
			return 0, errors.New("token-range split applies to whole tables only")
		}
		if cfg.Ranges > MaxRanges {
			return 0, fmt.Errorf("token-range split is limited to %d ranges", MaxRanges)
		}
		if len(src.PartitionKey) == 0 {
			return 0, errors.New("token-range split needs the table's partition key")
		}
		pk := make([]string, len(src.PartitionKey))
		for i, c := range src.PartitionKey {
			pk[i] = cql.QuoteIdent(c)
		}
		tok := "token(" + strings.Join(pk, ", ") + ")"
		jobs = jobs[:0]
		for _, rg := range TokenRanges(cfg.Ranges) {
			jobs = append(jobs, job{cql: stmt + " WHERE " + tok + " >= ? AND " + tok + " <= ?", args: []any{rg[0], rg[1]}})
		}
	}
	workers := cfg.Concurrency
	if workers < 1 {
		workers = 1
	}
	if workers > len(jobs) {
		workers = len(jobs)
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	out := make(chan batch, workers)
	todo := make(chan job)
	var firstErr atomic.Value
	setErr := func(err error) {
		firstErr.CompareAndSwap(nil, err)
		cancel()
	}
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range todo {
				var state []byte
				for {
					res, err := r.Run(ctx, exec.Request{CQL: j.cql, Args: j.args, Consistency: cfg.Consistency,
						PageSize: cfg.PageSize, PageState: state})
					if err != nil {
						setErr(err)
						return
					}
					select {
					case out <- batch{cols: res.Columns, rows: res.Raw}:
					case <-ctx.Done():
						return
					}
					if !res.HasMore {
						break
					}
					if state, err = decodePageState(res.PageState); err != nil {
						setErr(err)
						return
					}
				}
			}
		}()
	}
	go func() {
		defer close(todo)
		for _, j := range jobs {
			select {
			case todo <- j:
			case <-ctx.Done():
				return
			}
		}
	}()
	go func() { wg.Wait(); close(out) }()

	var n int64
	started := false
	begin := time.Now()
	var werr error
	for b := range out {
		if werr != nil {
			continue // drain so workers can exit
		}
		if !started {
			if werr = w.Begin(b.cols); werr != nil {
				cancel()
				continue
			}
			started = true
		}
		for _, row := range b.rows {
			if werr = w.Row(row); werr != nil {
				cancel()
				break
			}
			n++
			if cfg.RowsPerSecond > 0 {
				due := begin.Add(time.Duration(float64(n) / float64(cfg.RowsPerSecond) * float64(time.Second)))
				if d := time.Until(due); d > 0 {
					select {
					case <-time.After(d):
					case <-ctx.Done():
					}
				}
			}
		}
		if cfg.Progress != nil {
			cfg.Progress(n)
		}
	}
	if werr != nil {
		return n, werr
	}
	if err, _ := firstErr.Load().(error); err != nil {
		return n, err
	}
	if err := ctx.Err(); err != nil {
		return n, err
	}
	if !started { // no rows at all: still emit an empty document with the columns of a probe
		return n, errors.New("export returned no result columns")
	}
	return n, w.End()
}

// UDTResolver is the codec's UDT field resolver type.
type UDTResolver = func(codec.UDTRef) map[string]codec.TypeDesc
