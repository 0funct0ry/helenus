package seed

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	gocql "github.com/apache/cassandra-gocql-driver/v2"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/cql"
	"github.com/0funct0ry/helenus/internal/jobs"
	"github.com/0funct0ry/helenus/internal/schema"
)

// Executor runs one bound statement at the given consistency.
type Executor interface {
	Exec(ctx context.Context, cql string, args []any, consistency string) error
}

// Result is the outcome stored on the seed job.
type Result struct {
	Written    int64    `json:"written"`
	Errors     int64    `json:"errors"`
	Skipped    int      `json:"skipped_duplicates"`
	Partitions int      `json:"partitions"`
	FirstErrs  []string `json:"first_errors"`
	Keyspace   string   `json:"keyspace"`
	Table      string   `json:"table"`
}

func qname(t schema.Table) string { return schema.Ident(t.Keyspace) + "." + schema.Ident(t.Name) }

// Statement builds the prepared statement and the column order of its markers.
func (p *Plan) Statement() (string, []int) {
	t := p.Table
	var idx []int
	if t.Counter {
		var sets, where []string
		keys := p.keyColumns()
		for _, i := range keys {
			where = append(where, schema.Ident(t.Columns[i].Name)+" = ?")
		}
		for i, c := range t.Columns {
			if c.Kind != schema.KindPartition && c.Kind != schema.KindClustering && c.Type.Name == "counter" {
				sets = append(sets, schema.Ident(c.Name)+" = "+schema.Ident(c.Name)+" + ?")
				idx = append(idx, i)
			}
		}
		// Markers: SET values first, then the WHERE keys in primary-key order.
		idx = append(idx, keys...)
		return fmt.Sprintf("UPDATE %s SET %s WHERE %s", qname(t), strings.Join(sets, ", "), strings.Join(where, " AND ")), idx
	}
	names := make([]string, len(t.Columns))
	marks := make([]string, len(t.Columns))
	for i, c := range t.Columns {
		names[i], marks[i] = schema.Ident(c.Name), "?"
		idx = append(idx, i)
	}
	s := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", qname(t), strings.Join(names, ", "), strings.Join(marks, ", "))
	if p.Cfg.IfNotExists {
		s += " IF NOT EXISTS"
	}
	if p.Cfg.TTL > 0 {
		s += fmt.Sprintf(" USING TTL %d", p.Cfg.TTL)
	}
	return s, idx
}

// args converts a generated row into driver values in marker order. Null
// values become UNSET so no tombstones are written.
func (p *Plan) args(row []any, idx []int) ([]any, error) {
	var udt codec.UDTFieldTypes
	if p.snap != nil {
		udt = p.snap.UDTFields
	}
	out := make([]any, len(idx))
	for k, i := range idx {
		if row[i] == nil {
			out[k] = gocql.UnsetValue
			continue
		}
		raw, err := json.Marshal(row[i])
		if err != nil {
			return nil, err
		}
		v, err := codec.Decode(raw, p.Table.Columns[i].Type, udt)
		if err != nil {
			return nil, fmt.Errorf("column %s: %w", p.Table.Columns[i].Name, err)
		}
		out[k] = v
	}
	return out, nil
}

// Sample renders the first row as a literal statement for the preview.
func (p *Plan) Sample(row []any) string {
	if row == nil {
		return ""
	}
	var udt codec.UDTFieldTypes
	if p.snap != nil {
		udt = p.snap.UDTFields
	}
	t := p.Table
	lit := func(i int) string {
		if row[i] == nil {
			return "null"
		}
		raw, _ := json.Marshal(row[i])
		v, err := codec.Decode(raw, t.Columns[i].Type, udt)
		if err != nil {
			return "null"
		}
		return cql.RenderLiteralUDT(v, t.Columns[i].Type, udt)
	}
	if t.Counter {
		var sets, where []string
		for _, i := range p.keyColumns() {
			where = append(where, schema.Ident(t.Columns[i].Name)+" = "+lit(i))
		}
		for i, c := range t.Columns {
			if c.Kind != schema.KindPartition && c.Kind != schema.KindClustering && c.Type.Name == "counter" {
				sets = append(sets, schema.Ident(c.Name)+" = "+schema.Ident(c.Name)+" + "+lit(i))
			}
		}
		return fmt.Sprintf("UPDATE %s SET %s WHERE %s;", qname(t), strings.Join(sets, ", "), strings.Join(where, " AND "))
	}
	var names, vals []string
	for i, c := range t.Columns {
		if row[i] == nil {
			continue
		}
		names, vals = append(names, schema.Ident(c.Name)), append(vals, lit(i))
	}
	s := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", qname(t), strings.Join(names, ", "), strings.Join(vals, ", "))
	if p.Cfg.IfNotExists {
		s += " IF NOT EXISTS"
	}
	if p.Cfg.TTL > 0 {
		s += fmt.Sprintf(" USING TTL %d", p.Cfg.TTL)
	}
	return s + ";"
}

// Run writes every row. It returns ctx's error when cancelled and an error when
// too many writes failed; the Result is always stored on the reporter first.
func (p *Plan) Run(ctx context.Context, ex Executor, rep *jobs.Reporter) error {
	stmt, idx := p.Statement()
	total := int64(p.Cfg.TotalRows)
	var written, errs atomic.Int64
	var mu sync.Mutex
	var first []string

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	aborted := false

	rows := make(chan []any, p.Cfg.Concurrency*4)
	var wg sync.WaitGroup
	for w := 0; w < p.Cfg.Concurrency; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for row := range rows {
				if ctx.Err() != nil {
					continue
				}
				args, err := p.args(row, idx)
				if err == nil {
					err = ex.Exec(ctx, stmt, args, p.Cfg.Consistency)
				}
				if err != nil {
					if ctx.Err() != nil {
						continue
					}
					n := errs.Add(1)
					mu.Lock()
					if len(first) < 100 {
						first = append(first, err.Error())
					}
					if n >= maxErrorsAborted && !aborted {
						aborted = true
						cancel()
					}
					mu.Unlock()
					continue
				}
				written.Add(1)
			}
		}()
	}

	stop := make(chan struct{})
	ticked := make(chan struct{})
	go func() {
		defer close(ticked)
		t := time.NewTicker(200 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				rep.Update(written.Load(), total, errs.Load())
			case <-stop:
				return
			}
		}
	}()

produce:
	for {
		row, ok := p.Next()
		if !ok {
			break
		}
		select {
		case rows <- row:
		case <-ctx.Done():
			break produce
		}
	}
	close(rows)
	wg.Wait()
	close(stop)
	<-ticked

	mu.Lock()
	res := Result{Written: written.Load(), Errors: errs.Load(), Skipped: p.Skipped, Partitions: p.nParts,
		FirstErrs: append([]string{}, first...), Keyspace: p.Table.Keyspace, Table: p.Table.Name}
	wasAborted := aborted
	mu.Unlock()
	rep.Update(res.Written, total, res.Errors)
	rep.SetResult(res)
	if wasAborted {
		return fmt.Errorf("aborted after %d write errors", maxErrorsAborted)
	}
	return ctx.Err()
}

// keyColumns returns the primary-key column indexes: partition columns, then
// clustering columns, each by position.
func (p *Plan) keyColumns() []int {
	var out []int
	for _, kind := range []string{schema.KindPartition, schema.KindClustering} {
		var idx []int
		for i, c := range p.Table.Columns {
			if c.Kind == kind {
				idx = append(idx, i)
			}
		}
		sort.SliceStable(idx, func(a, b int) bool { return p.Table.Columns[idx[a]].Position < p.Table.Columns[idx[b]].Position })
		out = append(out, idx...)
	}
	return out
}
