package shell

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/0funct0ry/helenus/internal/dataio/export"
	"github.com/0funct0ry/helenus/internal/exec"
)

// copyCmd is a parsed COPY ... TO or COPY ... FROM statement.
type copyCmd struct {
	// From is true for COPY FROM; Stdin then reads the shell's input instead of File.
	From  bool
	Stdin bool
	// MaxBatchSize, MaxErrors and ErrFile are COPY FROM options (ChunkSize is accepted and ignored).
	MaxBatchSize int
	MaxErrors    int
	ErrFile      string

	Keyspace, Table string
	Columns         []string
	// File is the target path; Stdout writes to the shell's output instead.
	File          string
	Stdout        bool
	Opts          export.Options
	PageSize      int
	MaxOutputSize int
}

// isCopy reports whether the statement starts with the COPY keyword.
func isCopy(body string) bool {
	f := strings.Fields(body)
	return len(f) > 0 && strings.EqualFold(f[0], "copy")
}

// copyLexer reads the COPY grammar one token at a time.
type copyLexer struct {
	s string
	i int
}

func (l *copyLexer) skip() {
	for l.i < len(l.s) && strings.ContainsRune(" \t\r\n", rune(l.s[l.i])) {
		l.i++
	}
}

func (l *copyLexer) eof() bool { l.skip(); return l.i >= len(l.s) }

// peek returns the next byte without consuming it, or 0 at the end.
func (l *copyLexer) peek() byte {
	l.skip()
	if l.i >= len(l.s) {
		return 0
	}
	return l.s[l.i]
}

// ident reads an identifier: "quoted" keeps its case, a bare one is lowercased.
func (l *copyLexer) ident() (string, error) {
	l.skip()
	if l.i >= len(l.s) {
		return "", errors.New("expected a name")
	}
	if l.s[l.i] == '"' {
		var b strings.Builder
		for l.i++; l.i < len(l.s); l.i++ {
			if l.s[l.i] == '"' {
				if l.i+1 < len(l.s) && l.s[l.i+1] == '"' {
					b.WriteByte('"')
					l.i++
					continue
				}
				l.i++
				return b.String(), nil
			}
			b.WriteByte(l.s[l.i])
		}
		return "", errors.New("unterminated quoted name")
	}
	start := l.i
	for l.i < len(l.s) && (l.s[l.i] == '_' || l.s[l.i] >= '0' && l.s[l.i] <= '9' || l.s[l.i]|0x20 >= 'a' && l.s[l.i]|0x20 <= 'z') {
		l.i++
	}
	if start == l.i {
		return "", fmt.Errorf("unexpected %q", string(l.s[l.i]))
	}
	return strings.ToLower(l.s[start:l.i]), nil
}

// word reads a bare keyword, uppercased.
func (l *copyLexer) word() string {
	l.skip()
	start := l.i
	for l.i < len(l.s) && (l.s[l.i] == '_' || l.s[l.i]|0x20 >= 'a' && l.s[l.i]|0x20 <= 'z') {
		l.i++
	}
	return strings.ToUpper(l.s[start:l.i])
}

// str reads a 'single quoted' string (” is a quote).
func (l *copyLexer) str() (string, error) {
	l.skip()
	if l.i >= len(l.s) || l.s[l.i] != '\'' {
		return "", errors.New("expected a quoted string")
	}
	var b strings.Builder
	for l.i++; l.i < len(l.s); l.i++ {
		if l.s[l.i] == '\'' {
			if l.i+1 < len(l.s) && l.s[l.i+1] == '\'' {
				b.WriteByte('\'')
				l.i++
				continue
			}
			l.i++
			return b.String(), nil
		}
		b.WriteByte(l.s[l.i])
	}
	return "", errors.New("unterminated string")
}

// value reads an option value: a quoted string or a bare token.
func (l *copyLexer) value() (string, error) {
	if l.peek() == '\'' {
		return l.str()
	}
	start := l.i
	for l.i < len(l.s) && !strings.ContainsRune(" \t\r\n;", rune(l.s[l.i])) {
		l.i++
	}
	if start == l.i {
		return "", errors.New("expected a value")
	}
	return l.s[start:l.i], nil
}

// parseCopy parses COPY [ks.]table [(cols)] TO 'file'|STDOUT or FROM 'file'|STDIN [WITH opt=val [AND opt=val]...].
func parseCopy(text, defaultKS string) (*copyCmd, error) {
	l := &copyLexer{s: strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(text), ";"))}
	if l.word() != "COPY" {
		return nil, errors.New("not a COPY statement")
	}
	c := &copyCmd{Keyspace: defaultKS, PageSize: 1000, Opts: export.Options{LineTerminator: "\n"}}
	name, err := l.ident()
	if err != nil {
		return nil, fmt.Errorf("COPY: %w", err)
	}
	if l.i < len(l.s) && l.s[l.i] == '.' {
		l.i++
		c.Keyspace = name
		if name, err = l.ident(); err != nil {
			return nil, fmt.Errorf("COPY: %w", err)
		}
	}
	c.Table = name
	if c.Keyspace == "" {
		return nil, errors.New("COPY: no keyspace selected; use ks.table or USE a keyspace")
	}
	if l.peek() == '(' {
		l.i++
		for {
			col, err := l.ident()
			if err != nil {
				return nil, fmt.Errorf("COPY: column list: %w", err)
			}
			c.Columns = append(c.Columns, col)
			switch l.peek() {
			case ',':
				l.i++
				continue
			case ')':
				l.i++
			default:
				return nil, errors.New("COPY: expected , or ) in the column list")
			}
			break
		}
	}
	switch kw := l.word(); kw {
	case "TO":
	case "FROM":
		c.From = true
	default:
		return nil, errors.New("COPY: expected TO or FROM after the table name")
	}
	l.skip()
	if c.From && l.peek() != '\'' {
		if l.word() != "STDIN" {
			return nil, errors.New("COPY: expected 'file' or STDIN after FROM")
		}
		c.Stdin = true
	} else if l.peek() == '\'' {
		if c.File, err = l.str(); err != nil {
			return nil, fmt.Errorf("COPY: %w", err)
		}
		if c.File == "" {
			return nil, errors.New("COPY: empty file name")
		}
	} else if w := l.word(); w == "STDOUT" {
		c.Stdout = true
	} else {
		return nil, errors.New("COPY: expected 'file' or STDOUT after TO")
	}
	if l.eof() {
		return c, nil
	}
	if l.word() != "WITH" {
		return nil, errors.New("COPY: expected WITH or the end of the statement")
	}
	for {
		opt := l.word()
		if opt == "" {
			return nil, errors.New("COPY: expected an option name")
		}
		l.skip()
		if l.i >= len(l.s) || l.s[l.i] != '=' {
			return nil, fmt.Errorf("COPY: expected = after %s", opt)
		}
		l.i++
		v, err := l.value()
		if err != nil {
			return nil, fmt.Errorf("COPY: %s: %w", opt, err)
		}
		if err := c.set(opt, v); err != nil {
			return nil, err
		}
		if l.eof() {
			return c, nil
		}
		if l.word() != "AND" {
			return nil, errors.New("COPY: separate options with AND")
		}
	}
}

func (c *copyCmd) set(opt, v string) error {
	switch opt {
	case "PAGESIZE", "MAXOUTPUTSIZE", "DATETIMEFORMAT":
		if c.From {
			return fmt.Errorf("COPY: %s only applies to COPY TO", opt)
		}
	case "CHUNKSIZE", "MAXBATCHSIZE", "MAXERRORS", "ERRFILE":
		if !c.From {
			return fmt.Errorf("COPY: %s only applies to COPY FROM", opt)
		}
		return c.setFrom(opt, v)
	}
	switch opt {
	case "HEADER":
		b, err := strconv.ParseBool(strings.ToLower(v))
		if err != nil {
			return errors.New("COPY: HEADER must be true or false")
		}
		c.Opts.Header = b
	case "DELIMITER":
		c.Opts.Delimiter = v
	case "QUOTE":
		c.Opts.Quote = v
	case "NULL":
		c.Opts.NullString = v
	case "DATETIMEFORMAT":
		c.Opts.DateTimeFormat = v
	case "PAGESIZE":
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			return errors.New("COPY: PAGESIZE must be a positive number")
		}
		c.PageSize = n
	case "MAXOUTPUTSIZE":
		n, err := strconv.Atoi(v)
		if err != nil || (n < 1 && n != -1) {
			return errors.New("COPY: MAXOUTPUTSIZE must be a positive number of rows or -1")
		}
		if n > 0 && c.Stdout {
			return errors.New("COPY: MAXOUTPUTSIZE needs a file target")
		}
		c.MaxOutputSize = max(n, 0)
	default:
		return fmt.Errorf("COPY: unsupported option %s", opt)
	}
	return nil
}

// copyStmt parses a COPY statement and runs it in the direction it names.
func (s *Shell) copyStmt(ctx context.Context, text string) error {
	if s.Exec == nil {
		return errors.New("not connected")
	}
	c, err := parseCopy(text, s.Keyspace)
	if err != nil {
		return syntaxErr(err.Error())
	}
	if c.From {
		return s.copyFrom(ctx, c)
	}
	return s.copyTo(ctx, c)
}

// copyTo runs a COPY ... TO statement.
func (s *Shell) copyTo(ctx context.Context, c *copyCmd) error {
	c.Opts.Table = c.Keyspace + "." + c.Table
	if err := c.Opts.Validate(export.CSV); err != nil {
		return syntaxErr("COPY: " + err.Error())
	}
	var newOut func(n int) (io.WriteCloser, error)
	if c.Stdout {
		newOut = func(int) (io.WriteCloser, error) { return nopCloser{s.Out}, nil }
	} else {
		newOut = func(n int) (io.WriteCloser, error) { return os.Create(rotatedName(c.File, n)) }
	}
	w := &rotatingWriter{max: c.MaxOutputSize, open: newOut, opts: c.Opts, udt: s.UDTFields}
	if !c.Stdout {
		w.rm = func(n int) { _ = os.Remove(rotatedName(c.File, n)) }
	}
	defer w.discard()

	var rows atomic.Int64
	start := time.Now()
	done := make(chan struct{})
	go func() {
		t := time.NewTicker(time.Second)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				fmt.Fprintf(s.Err, "Processed %d rows; %.0f rows/s\n", rows.Load(), float64(rows.Load())/time.Since(start).Seconds())
			case <-done:
				return
			}
		}
	}()
	defer close(done)

	n, err := export.Run(ctx, copyRunner{s.Exec}, export.Source{Keyspace: c.Keyspace, Table: c.Table, Columns: c.Columns},
		export.Config{PageSize: c.PageSize, Consistency: s.Consistency, Progress: rows.Store}, w)
	if err != nil {
		w.remove()
		return err
	}
	if err := w.close(); err != nil {
		w.remove()
		return err
	}
	took := time.Since(start).Seconds()
	msg := fmt.Sprintf("%d rows exported to %d file(s) in %.3f seconds.\n", n, max(w.files, 1), took)
	if c.Stdout {
		fmt.Fprint(s.Err, msg)
	} else {
		fmt.Fprint(s.Out, msg)
	}
	return nil
}

type nopCloser struct{ io.Writer }

func (nopCloser) Close() error { return nil }

// copyRunner pins reads to the shell's executor.
type copyRunner struct{ x Executor }

func (r copyRunner) Run(ctx context.Context, req exec.Request) (*exec.Result, error) {
	return r.x.Run(ctx, req)
}

// rotatedName is the n-th output file: the plain name first, then name.001, name.002, ...
func rotatedName(file string, n int) string {
	if n == 0 {
		return file
	}
	return fmt.Sprintf("%s.%03d", file, n)
}
