package importer

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	gocql "github.com/apache/cassandra-gocql-driver/v2"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/schema"
)

// Limits and defaults of the import options.
const (
	DefaultConcurrency = 8
	MaxConcurrency     = 64
	DefaultBatchSize   = 1
	MaxBatchSize       = 100
	DefaultMaxErrors   = 1000
	retryAttempts      = 3
)

// retryDelay is the first backoff; it doubles per attempt. Tests shrink it.
var retryDelay = 100 * time.Millisecond

// Executor runs one bound statement at the given consistency.
type Executor interface {
	Exec(ctx context.Context, cql string, args []any, consistency string) error
}

// Mapping assigns a source column to a target column; an empty Source skips the target.
type Mapping struct {
	Target string `json:"target"`
	Source string `json:"source"`
}

// Options are the write options of an import.
type Options struct {
	Consistency string `json:"consistency"`
	TTL         int    `json:"ttl"`
	IfNotExists bool   `json:"if_not_exists"`
	Concurrency int    `json:"concurrency"`
	BatchSize   int    `json:"batch_size"`
	MaxErrors   int    `json:"max_errors"`
}

// Normalized fills defaults and returns a problem description, if any.
func (o Options) Normalized() (Options, error) {
	if o.Consistency == "" {
		o.Consistency = "LOCAL_QUORUM"
	}
	if strings.EqualFold(o.Consistency, "ANY") {
		return o, errors.New("consistency ANY is not allowed for imports")
	}
	if o.Concurrency == 0 {
		o.Concurrency = DefaultConcurrency
	}
	if o.Concurrency < 1 || o.Concurrency > MaxConcurrency {
		return o, fmt.Errorf("concurrency must be between 1 and %d", MaxConcurrency)
	}
	if o.BatchSize == 0 {
		o.BatchSize = DefaultBatchSize
	}
	if o.BatchSize < 1 || o.BatchSize > MaxBatchSize {
		return o, fmt.Errorf("batch size must be between 1 and %d", MaxBatchSize)
	}
	if o.MaxErrors == 0 {
		o.MaxErrors = DefaultMaxErrors
	}
	if o.MaxErrors < 1 {
		return o, errors.New("max errors must be at least 1")
	}
	if o.TTL < 0 {
		return o, errors.New("ttl cannot be negative")
	}
	return o, nil
}

// Job is everything needed to import into one table.
type Job struct {
	Table   schema.Table
	UDT     codec.UDTFieldTypes
	Mapping []Mapping
	Opts    Options
}

// RowError is one rejected value; a rejected record has one or more.
type RowError struct {
	Line   int64    `json:"line"`
	Column string   `json:"column"`
	Value  string   `json:"value"`
	Reason string   `json:"reason"`
	Record []string `json:"record,omitempty"`
}

// Result is the outcome of an import.
type Result struct {
	Rows      int64      `json:"rows"`
	Written   int64      `json:"written"`
	Rejected  int64      `json:"rejected"`
	FirstErrs []RowError `json:"first_errors"`
	Keyspace  string     `json:"keyspace"`
	Table     string     `json:"table"`
}

// column is a mapped target column ready to convert values.
type column struct {
	col    schema.Column
	source string
}

func (j Job) columns() ([]column, error) {
	byName := map[string]schema.Column{}
	for _, c := range j.Table.Columns {
		byName[c.Name] = c
	}
	var out []column
	seen := map[string]bool{}
	for _, m := range j.Mapping {
		if m.Source == "" {
			continue
		}
		c, ok := byName[m.Target]
		if !ok {
			return nil, fmt.Errorf("table %s has no column %s", j.Table.Name, m.Target)
		}
		if seen[m.Target] {
			return nil, fmt.Errorf("column %s is mapped twice", m.Target)
		}
		seen[m.Target] = true
		out = append(out, column{col: c, source: m.Source})
	}
	return out, nil
}

// MissingKeys lists primary key columns that have no source column.
func (j Job) MissingKeys() []string {
	mapped := map[string]bool{}
	for _, m := range j.Mapping {
		if m.Source != "" {
			mapped[m.Target] = true
		}
	}
	var out []string
	for _, c := range j.Table.Columns {
		if (c.Kind == schema.KindPartition || c.Kind == schema.KindClustering) && !mapped[c.Name] {
			out = append(out, c.Name)
		}
	}
	return out
}

// Validate reports problems that stop an import before it reads any row.
func (j Job) Validate() error {
	if j.Table.Counter {
		return errors.New("counter tables cannot be imported")
	}
	if _, err := j.columns(); err != nil {
		return err
	}
	if miss := j.MissingKeys(); len(miss) > 0 {
		return fmt.Errorf("Map a source column to %s", strings.Join(miss, ", "))
	}
	return nil
}

func qname(t schema.Table) string { return schema.Ident(t.Keyspace) + "." + schema.Ident(t.Name) }

// Statement returns the INSERT for the mapped columns.
func (j Job) Statement() (string, error) {
	cols, err := j.columns()
	if err != nil {
		return "", err
	}
	names := make([]string, len(cols))
	marks := make([]string, len(cols))
	for i, c := range cols {
		names[i], marks[i] = schema.Ident(c.col.Name), "?"
	}
	s := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", qname(j.Table), strings.Join(names, ", "), strings.Join(marks, ", "))
	if j.Opts.IfNotExists {
		s += " IF NOT EXISTS"
	}
	if j.Opts.TTL > 0 {
		s += fmt.Sprintf(" USING TTL %d", j.Opts.TTL)
	}
	return s, nil
}

// converted is a record turned into bind values.
type converted struct {
	rec  Record
	args []any
	part string
}

// convertRecord converts one record. All failing columns are returned.
func convertRecord(rec Record, cols []column, udt codec.UDTFieldTypes) (converted, []RowError) {
	if rec.Err != nil {
		return converted{}, []RowError{{Line: rec.Line, Reason: rec.Err.Error(), Record: rec.Raw}}
	}
	out := converted{rec: rec, args: make([]any, len(cols))}
	var errs []RowError
	var part []string
	for i, c := range cols {
		raw := rec.Vals[c.source]
		v, err := Convert(raw, c.col.Type, udt)
		if err == nil && v == nil && (c.col.Kind == schema.KindPartition || c.col.Kind == schema.KindClustering) {
			err = errors.New("primary key column cannot be empty")
		}
		if err != nil {
			errs = append(errs, RowError{Line: rec.Line, Column: c.col.Name, Value: Text(raw), Reason: err.Error(), Record: rec.Raw})
			continue
		}
		if v == nil {
			v = gocql.UnsetValue
		}
		out.args[i] = v
		if c.col.Kind == schema.KindPartition {
			part = append(part, fmt.Sprintf("%v", v))
		}
	}
	out.part = strings.Join(part, "\x1f")
	return out, errs
}

// ColumnCheck is the type-check outcome of one mapped column.
type ColumnCheck struct {
	Target   string     `json:"target"`
	Failures int        `json:"failures"`
	Samples  []RowError `json:"samples"`
}

// Check converts records and counts failures per mapped column, keeping up to
// five samples each. It returns the number of records it examined.
func (j Job) Check(recs []Record) ([]ColumnCheck, int, error) {
	cols, err := j.columns()
	if err != nil {
		return nil, 0, err
	}
	out := make([]ColumnCheck, len(cols))
	idx := map[string]int{}
	for i, c := range cols {
		out[i].Target = c.col.Name
		out[i].Samples = []RowError{}
		idx[c.col.Name] = i
	}
	n := 0
	for _, rec := range recs {
		n++
		_, errs := convertRecord(rec, cols, j.UDT)
		for _, e := range errs {
			i, ok := idx[e.Column]
			if !ok {
				continue
			}
			out[i].Failures++
			if len(out[i].Samples) < 5 {
				e.Record = nil
				out[i].Samples = append(out[i].Samples, e)
			}
		}
	}
	return out, n, nil
}

// DryRun parses and validates up to n records and writes nothing.
func (j Job) DryRun(rd *Reader, n int) (valid, total int, errs []RowError, err error) {
	cols, err := j.columns()
	if err != nil {
		return 0, 0, nil, err
	}
	for total < n {
		rec, rerr := rd.Next()
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return valid, total, errs, rerr
		}
		total++
		_, e := convertRecord(rec, cols, j.UDT)
		if len(e) == 0 {
			valid++
		}
		errs = append(errs, e...)
	}
	return valid, total, errs, nil
}

// errorFile writes rejected rows as CSV: line, column, value, reason and the original record.
type errorFile struct {
	mu     sync.Mutex
	w      *csv.Writer
	headed bool
}

func newErrorFile(w io.Writer) *errorFile {
	if w == nil {
		return nil
	}
	return &errorFile{w: csv.NewWriter(w)}
}

func (e *errorFile) add(r RowError) {
	if e == nil {
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if !e.headed {
		e.headed = true
		_ = e.w.Write([]string{"line", "column", "value", "reason", "record"})
	}
	rec := []string{fmt.Sprint(r.Line), r.Column, r.Value, r.Reason}
	rec = append(rec, r.Record...)
	_ = e.w.Write(rec)
}

func (e *errorFile) flush() error {
	if e == nil {
		return nil
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.w.Flush()
	return e.w.Error()
}

// Progress receives (done, total, errors) while an import runs.
type Progress func(done, total, errs int64)

// retryable reports whether a write failure is worth another attempt.
func retryable(err error) bool {
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "timeout") || strings.Contains(s, "timed out") || strings.Contains(s, "unavailable")
}

func execRetry(ctx context.Context, ex Executor, stmt string, args []any, cons string) error {
	var err error
	delay := retryDelay
	for attempt := 0; attempt < retryAttempts; attempt++ {
		if err = ex.Exec(ctx, stmt, args, cons); err == nil || !retryable(err) {
			return err
		}
		if attempt == retryAttempts-1 {
			break
		}
		select {
		case <-time.After(delay):
		case <-ctx.Done():
			return ctx.Err()
		}
		delay *= 2
	}
	return err
}

// unit is one write: a single row, or an unlogged batch of rows of one partition.
type unit struct{ rows []converted }

// Run imports every record of rd. Rejected rows go to errw (CSV) when it is not
// nil. total is the expected record count for progress, or 0 when unknown. It
// returns ctx's error when cancelled and an error when MaxErrors was exceeded;
// the Result is valid either way.
func (j Job) Run(ctx context.Context, ex Executor, rd *Reader, errw io.Writer, total int64, prog Progress) (Result, error) {
	res := Result{Keyspace: j.Table.Keyspace, Table: j.Table.Name, FirstErrs: []RowError{}}
	opts, err := j.Opts.Normalized()
	if err != nil {
		return res, err
	}
	j.Opts = opts
	if err := j.Validate(); err != nil {
		return res, err
	}
	cols, _ := j.columns()
	stmt, _ := j.Statement()

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	ef := newErrorFile(errw)
	var rows, written, rejected atomic.Int64
	var mu sync.Mutex
	aborted := false
	report := func(errs ...RowError) {
		if len(errs) == 0 {
			return
		}
		for _, e := range errs {
			ef.add(e)
		}
		mu.Lock()
		for _, e := range errs {
			if len(res.FirstErrs) < 100 {
				res.FirstErrs = append(res.FirstErrs, e)
			}
		}
		mu.Unlock()
	}
	reject := func(n int64) {
		if rejected.Add(n) > int64(opts.MaxErrors) {
			mu.Lock()
			aborted = true
			mu.Unlock()
			cancel()
		}
	}

	units := make(chan unit, opts.Concurrency*4)
	var wg sync.WaitGroup
	for w := 0; w < opts.Concurrency; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for u := range units {
				if ctx.Err() != nil {
					continue
				}
				s, args := stmt, u.rows[0].args
				if len(u.rows) > 1 {
					parts := make([]string, len(u.rows))
					args = nil
					for i, r := range u.rows {
						parts[i] = stmt
						args = append(args, r.args...)
					}
					s = "BEGIN UNLOGGED BATCH " + strings.Join(parts, "; ") + "; APPLY BATCH"
				}
				if err := execRetry(ctx, ex, s, args, opts.Consistency); err != nil {
					if ctx.Err() != nil {
						continue
					}
					for _, r := range u.rows {
						report(RowError{Line: r.rec.Line, Reason: err.Error(), Record: r.rec.Raw})
					}
					reject(int64(len(u.rows)))
					continue
				}
				written.Add(int64(len(u.rows)))
			}
		}()
	}

	stop := make(chan struct{})
	ticked := make(chan struct{})
	go func() {
		defer close(ticked)
		if prog == nil {
			return
		}
		t := time.NewTicker(200 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				prog(written.Load()+rejected.Load(), total, rejected.Load())
			case <-stop:
				return
			}
		}
	}()

	var cur []converted
	flush := func() bool {
		if len(cur) == 0 {
			return true
		}
		u := unit{rows: cur}
		cur = nil
		select {
		case units <- u:
			return true
		case <-ctx.Done():
			return false
		}
	}
	var readErr error
produce:
	for {
		if ctx.Err() != nil {
			break
		}
		rec, rerr := rd.Next()
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			readErr = rerr
			break
		}
		rows.Add(1)
		cv, errs := convertRecord(rec, cols, j.UDT)
		if len(errs) > 0 {
			report(errs...)
			reject(1)
			continue
		}
		if len(cur) > 0 && (cur[0].part != cv.part || len(cur) >= opts.BatchSize) {
			if !flush() {
				break produce
			}
		}
		cur = append(cur, cv)
		if opts.BatchSize == 1 && !flush() {
			break produce
		}
	}
	if ctx.Err() == nil {
		flush()
	}
	close(units)
	wg.Wait()
	close(stop)
	<-ticked

	res.Rows, res.Written, res.Rejected = rows.Load(), written.Load(), rejected.Load()
	if prog != nil {
		prog(res.Written+res.Rejected, max(total, res.Written+res.Rejected), res.Rejected)
	}
	sort.SliceStable(res.FirstErrs, func(a, b int) bool { return res.FirstErrs[a].Line < res.FirstErrs[b].Line })
	if err := ef.flush(); err != nil && readErr == nil {
		readErr = err
	}
	mu.Lock()
	wasAborted := aborted
	mu.Unlock()
	switch {
	case wasAborted:
		return res, fmt.Errorf("aborted after more than %d rejected rows", opts.MaxErrors)
	case readErr != nil:
		return res, readErr
	}
	return res, ctx.Err()
}
