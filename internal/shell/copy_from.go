package shell

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/0funct0ry/helenus/internal/dataio/detect"
	"github.com/0funct0ry/helenus/internal/dataio/importer"
	"github.com/0funct0ry/helenus/internal/exec"
	"github.com/0funct0ry/helenus/internal/schema"
)

// setFrom applies the options that only COPY FROM has.
func (c *copyCmd) setFrom(opt, v string) error {
	n, err := strconv.Atoi(v)
	switch opt {
	case "ERRFILE":
		c.ErrFile = v
		return nil
	case "CHUNKSIZE":
		// Accepted for cqlsh compatibility; rows are streamed, so there is no chunk to size.
		if err != nil || n < 1 {
			return errors.New("COPY: CHUNKSIZE must be a positive number")
		}
	case "MAXBATCHSIZE":
		if err != nil || n < 1 || n > importer.MaxBatchSize {
			return fmt.Errorf("COPY: MAXBATCHSIZE must be between 1 and %d", importer.MaxBatchSize)
		}
		c.MaxBatchSize = n
	case "MAXERRORS":
		if err != nil || n < 1 {
			return errors.New("COPY: MAXERRORS must be a positive number")
		}
		c.MaxErrors = n
	}
	return nil
}

// shellExec adapts the shell's executor to importer.Executor.
type shellExec struct{ x Executor }

func (e shellExec) Exec(ctx context.Context, cql string, args []any, cons string) error {
	_, err := e.x.Run(ctx, exec.Request{CQL: cql, Args: args, Consistency: cons})
	return err
}

// lazyFile creates its file on the first write, so a clean import leaves no error file behind.
type lazyFile struct {
	path string
	f    *os.File
}

func (l *lazyFile) Write(p []byte) (int, error) {
	if l.f == nil {
		f, err := os.Create(l.path)
		if err != nil {
			return 0, err
		}
		l.f = f
	}
	return l.f.Write(p)
}

func (l *lazyFile) close() {
	if l.f != nil {
		_ = l.f.Close()
	}
}

// copyColumns returns the target columns: the listed ones, or every column with
// the primary key first, as cqlsh does.
func copyColumns(t schema.Table, listed []string) ([]string, error) {
	if len(listed) > 0 {
		have := map[string]bool{}
		for _, c := range t.Columns {
			have[c.Name] = true
		}
		for _, n := range listed {
			if !have[n] {
				return nil, fmt.Errorf("COPY: table %s has no column %s", t.Name, n)
			}
		}
		return listed, nil
	}
	cols := append([]schema.Column(nil), t.Columns...)
	rank := func(c schema.Column) int {
		switch c.Kind {
		case schema.KindPartition:
			return 0
		case schema.KindClustering:
			return 1
		}
		return 2
	}
	sort.SliceStable(cols, func(a, b int) bool {
		ra, rb := rank(cols[a]), rank(cols[b])
		if ra != rb {
			return ra < rb
		}
		return ra < 2 && cols[a].Position < cols[b].Position
	})
	out := make([]string, len(cols))
	for i, c := range cols {
		out[i] = c.Name
	}
	return out, nil
}

// copyFrom runs COPY ... FROM: CSV rows are mapped to the columns by position
// (the header row, if any, is skipped), as in cqlsh.
func (s *Shell) copyFrom(ctx context.Context, c *copyCmd) error {
	if s.Schema == nil {
		return errors.New("COPY FROM needs the schema, which is not available on this connection")
	}
	snap, err := s.Schema(ctx)
	if err != nil {
		return err
	}
	ks := snap.Keyspace(c.Keyspace)
	if ks == nil {
		return syntaxErr("COPY: keyspace " + c.Keyspace + " does not exist")
	}
	t := ks.Table(c.Table)
	if t == nil {
		return syntaxErr("COPY: table " + c.Keyspace + "." + c.Table + " does not exist")
	}
	targets, err := copyColumns(*t, c.Columns)
	if err != nil {
		return syntaxErr(err.Error())
	}
	format := importer.Format{Kind: detect.CSV, Delimiter: ",", Quote: `"`, Header: c.Opts.Header, NullString: c.Opts.NullString}
	if c.Opts.Delimiter != "" {
		format.Delimiter = c.Opts.Delimiter
	}
	if c.Opts.Quote != "" {
		format.Quote = c.Opts.Quote
	}
	if len([]rune(format.Delimiter)) != 1 {
		return syntaxErr("COPY: DELIMITER must be one character")
	}

	var in io.Reader = s.In
	if !c.Stdin {
		f, err := os.Open(c.File)
		if err != nil {
			return err
		}
		defer f.Close()
		in = f
	} else if in == nil {
		return errors.New("COPY FROM STDIN: no input is attached")
	}
	rd, err := importer.Open(in, format)
	if err != nil {
		return err
	}
	src := rd.Columns()
	if len(src) != len(targets) {
		return fmt.Errorf("COPY: the file has %d fields per row but %d columns are being loaded", len(src), len(targets))
	}
	mapping := make([]importer.Mapping, len(targets))
	for i, n := range targets {
		mapping[i] = importer.Mapping{Target: n, Source: src[i]}
	}
	job := importer.Job{Table: *t, UDT: snap.UDTFields, Mapping: mapping, Opts: importer.Options{
		Consistency: s.Consistency, BatchSize: c.MaxBatchSize, MaxErrors: c.MaxErrors}}
	if err := job.Validate(); err != nil {
		return syntaxErr("COPY: " + err.Error())
	}

	errPath := c.ErrFile
	if errPath == "" {
		errPath = fmt.Sprintf("import_%s_%s.err", c.Keyspace, c.Table)
	}
	ef := &lazyFile{path: errPath}
	defer ef.close()

	start := time.Now()
	var lastPrint time.Time
	prog := func(done, _, errs int64) {
		if time.Since(lastPrint) < time.Second {
			return
		}
		lastPrint = time.Now()
		fmt.Fprintf(s.Err, "Processed %d rows; %.0f rows/s; %d rejected\n", done, float64(done)/time.Since(start).Seconds(), errs)
	}
	res, err := job.Run(ctx, shellExec{s.Exec}, rd, ef, 0, prog)
	took := time.Since(start).Seconds()
	fmt.Fprintf(s.Err, "%d rows imported in %.3f seconds (%d rejected).\n", res.Written, took, res.Rejected)
	if res.Rejected > 0 {
		fmt.Fprintf(s.Err, "Rejected rows are in %s\n", strings.TrimSpace(errPath))
	}
	return err
}
