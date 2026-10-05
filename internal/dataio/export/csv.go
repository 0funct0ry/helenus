package export

import (
	"bufio"
	"io"
	"strings"

	"github.com/0funct0ry/helenus/internal/exec"
)

type csvWriter struct {
	cells
	w  io.Writer
	bw *bufio.Writer
	o  Options
}

func (c *csvWriter) Begin(cols []exec.Column) error {
	c.cols = cols
	c.bw = bufio.NewWriterSize(c.w, 64<<10)
	if !c.o.Header {
		return nil
	}
	names := make([]string, len(cols))
	for i, col := range cols {
		names[i] = c.field(col.Name)
	}
	return c.line(names)
}

func (c *csvWriter) Row(raw []any) error {
	f := make([]string, len(raw))
	for i, v := range raw {
		s, null := c.text(i, v)
		if null {
			s = c.o.NullString
		}
		f[i] = c.field(s)
	}
	return c.line(f)
}

func (c *csvWriter) line(fields []string) error {
	_, err := c.bw.WriteString(strings.Join(fields, c.o.delim()) + c.o.eol())
	return err
}

// field quotes s when it holds the delimiter, the quote, or a line break (RFC 4180).
func (c *csvWriter) field(s string) string {
	q := c.o.quote()
	if !strings.ContainsAny(s, c.o.delim()+q+"\r\n") {
		return s
	}
	return q + strings.ReplaceAll(s, q, q+q) + q
}

func (c *csvWriter) End() error {
	if c.bw == nil {
		return nil
	}
	return c.bw.Flush()
}
