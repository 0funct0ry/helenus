package export

import (
	"bufio"
	"io"
	"strings"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/cql"
	"github.com/0funct0ry/helenus/internal/exec"
)

// cqlWriter writes one INSERT statement per line.
type cqlWriter struct {
	cells
	w      io.Writer
	bw     *bufio.Writer
	o      Options
	udt    func(codec.UDTRef) map[string]codec.TypeDesc
	prefix string
}

func (c *cqlWriter) Begin(cols []exec.Column) error {
	c.cols = cols
	c.bw = bufio.NewWriterSize(c.w, 64<<10)
	names := make([]string, len(cols))
	for i, col := range cols {
		names[i] = cql.QuoteIdent(col.Name)
	}
	table := c.o.Table
	if table == "" {
		table = "export"
	} else {
		parts := strings.SplitN(table, ".", 2)
		for i := range parts {
			parts[i] = cql.QuoteIdent(parts[i])
		}
		table = strings.Join(parts, ".")
	}
	c.prefix = "INSERT INTO " + table + " (" + strings.Join(names, ", ") + ") VALUES ("
	return nil
}

func (c *cqlWriter) Row(raw []any) error {
	lits := make([]string, len(raw))
	for i, v := range raw {
		lits[i] = cql.RenderLiteralUDT(v, c.cols[i].Type, c.udt)
	}
	_, err := c.bw.WriteString(c.prefix + strings.Join(lits, ", ") + ");\n")
	return err
}

func (c *cqlWriter) End() error {
	if c.bw == nil {
		return nil
	}
	return c.bw.Flush()
}
