package export

import (
	"bufio"
	"encoding/xml"
	"io"

	"github.com/0funct0ry/helenus/internal/exec"
)

type xmlWriter struct {
	cells
	w  io.Writer
	bw *bufio.Writer
}

func (x *xmlWriter) esc(s string) string {
	var b []byte
	w := byteSink{&b}
	_ = xml.EscapeText(w, []byte(s))
	return string(b)
}

type byteSink struct{ b *[]byte }

func (s byteSink) Write(p []byte) (int, error) { *s.b = append(*s.b, p...); return len(p), nil }

func (x *xmlWriter) Begin(cols []exec.Column) error {
	x.cols = cols
	x.bw = bufio.NewWriterSize(x.w, 64<<10)
	_, err := x.bw.WriteString(xml.Header + "<rows>\n")
	return err
}

func (x *xmlWriter) Row(raw []any) error {
	_, _ = x.bw.WriteString("<row>")
	for i, v := range raw {
		name := x.esc(x.cols[i].Name)
		s, null := x.text(i, v)
		if null {
			_, _ = x.bw.WriteString(`<col name="` + name + `" nil="true"/>`)
			continue
		}
		_, _ = x.bw.WriteString(`<col name="` + name + `">` + x.esc(s) + `</col>`)
	}
	_, err := x.bw.WriteString("</row>\n")
	return err
}

func (x *xmlWriter) End() error {
	if x.bw == nil {
		return nil
	}
	if _, err := x.bw.WriteString("</rows>\n"); err != nil {
		return err
	}
	return x.bw.Flush()
}
