package shell

import (
	"io"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/dataio/export"
	"github.com/0funct0ry/helenus/internal/exec"
)

// rotatingWriter writes CSV and starts a new file after max rows (0 = never).
type rotatingWriter struct {
	max   int
	open  func(n int) (io.WriteCloser, error)
	rm    func(n int)
	opts  export.Options
	udt   func(codec.UDTRef) map[string]codec.TypeDesc
	cols  []exec.Column
	cur   export.Writer
	out   io.WriteCloser
	rows  int
	files int
	names []int
}

func (r *rotatingWriter) start() error {
	out, err := r.open(r.files)
	if err != nil {
		return err
	}
	w, err := export.NewWriter(export.CSV, out, r.opts, r.udt)
	if err != nil {
		_ = out.Close()
		return err
	}
	r.out, r.cur, r.rows = out, w, 0
	r.names = append(r.names, r.files)
	r.files++
	return w.Begin(r.cols)
}

func (r *rotatingWriter) finish() error {
	if r.cur == nil {
		return nil
	}
	err := r.cur.End()
	if cerr := r.out.Close(); err == nil {
		err = cerr
	}
	r.cur, r.out = nil, nil
	return err
}

func (r *rotatingWriter) Begin(cols []exec.Column) error {
	r.cols = cols
	return r.start()
}

func (r *rotatingWriter) Row(raw []any) error {
	if r.max > 0 && r.rows >= r.max {
		if err := r.finish(); err != nil {
			return err
		}
		if err := r.start(); err != nil {
			return err
		}
	}
	r.rows++
	return r.cur.Row(raw)
}

func (r *rotatingWriter) End() error { return r.finish() }

func (r *rotatingWriter) close() error { return r.finish() }

// discard closes an unfinished file after a failure.
func (r *rotatingWriter) discard() {
	if r.out != nil {
		_ = r.out.Close()
		r.out, r.cur = nil, nil
	}
}

// remove deletes every file written so far (a no-op for STDOUT).
func (r *rotatingWriter) remove() {
	r.discard()
	if r.rm == nil {
		return
	}
	for _, n := range r.names {
		r.rm(n)
	}
}
