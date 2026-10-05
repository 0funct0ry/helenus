package export

import (
	"bufio"
	"encoding/json"
	"io"

	"github.com/0funct0ry/helenus/internal/exec"
)

// jsonWriter writes a JSON array, or one object per line when lines is set.
type jsonWriter struct {
	cells
	w     io.Writer
	bw    *bufio.Writer
	lines bool
	names [][]byte
	n     int64
}

func (j *jsonWriter) Begin(cols []exec.Column) error {
	j.cols = cols
	j.bw = bufio.NewWriterSize(j.w, 64<<10)
	for _, c := range cols {
		b, _ := json.Marshal(c.Name)
		j.names = append(j.names, b)
	}
	if j.lines {
		return nil
	}
	_, err := j.bw.WriteString("[")
	return err
}

func (j *jsonWriter) Row(raw []any) error {
	if !j.lines {
		sep := ",\n"
		if j.n == 0 {
			sep = "\n"
		}
		if _, err := j.bw.WriteString(sep); err != nil {
			return err
		}
	}
	j.n++
	if err := j.bw.WriteByte('{'); err != nil {
		return err
	}
	for i, v := range raw {
		if i > 0 {
			_ = j.bw.WriteByte(',')
		}
		b, err := json.Marshal(j.json(i, v))
		if err != nil {
			return err
		}
		_, _ = j.bw.Write(j.names[i])
		_ = j.bw.WriteByte(':')
		_, _ = j.bw.Write(b)
	}
	if err := j.bw.WriteByte('}'); err != nil {
		return err
	}
	if j.lines {
		return j.bw.WriteByte('\n')
	}
	return nil
}

func (j *jsonWriter) End() error {
	if j.bw == nil {
		return nil
	}
	if !j.lines {
		tail := "\n]\n"
		if j.n == 0 {
			tail = "]\n"
		}
		if _, err := j.bw.WriteString(tail); err != nil {
			return err
		}
	}
	return j.bw.Flush()
}
