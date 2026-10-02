package shell

import (
	"fmt"
	"io"
	"strings"
	"unicode/utf8"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/exec"
)

// cells renders every value of res as display text. NULL is "null"; the raw
// renderer maps it to an empty field itself.
func (s *Shell) cells(res *exec.Result) [][]Cell {
	enc := codec.Encoder{UDTFields: s.UDTFields}
	out := make([][]Cell, len(res.Raw))
	for i, row := range res.Raw {
		r := make([]Cell, len(row))
		for j, v := range row {
			if v == nil {
				r[j] = Cell{Null: true, Text: "null"}
				continue
			}
			r[j] = Cell{Text: enc.Text(v, res.Columns[j].Type)}
		}
		out[i] = r
	}
	return out
}

// Cell is one rendered value; Null cells print as "null" in tables and as an
// empty field in raw output.
type Cell struct {
	Text string
	Null bool
}

// render prints one page. offset is the number of rows already printed and
// first reports whether this is the first page of the statement.
func (s *Shell) render(res *exec.Result, rows [][]Cell, offset int, first bool) {
	switch s.Format {
	case "expanded":
		RenderExpanded(s.Out, res.Columns, rows, offset)
	case "raw":
		RenderRaw(s.Out, res.Columns, rows, first)
	default:
		RenderTable(s.Out, res.Columns, rows, TableOptions{Width: s.width(), Styled: s.Styled})
	}
}

// TableOptions controls RenderTable.
type TableOptions struct {
	// Width is the terminal width; 0 means unlimited (no truncation).
	Width int
	// Styled emits bold partition key and underlined clustering key headers.
	Styled bool
}

const minColWidth = 6

func numeric(td codec.TypeDesc) bool {
	switch td.Name {
	case "int", "bigint", "smallint", "tinyint", "varint", "decimal", "float", "double", "counter":
		return true
	}
	return false
}

// oneLine makes a value safe for a single table line.
func oneLine(s string) string {
	if !strings.ContainsAny(s, "\n\r\t") {
		return s
	}
	return strings.NewReplacer("\r\n", `\n`, "\n", `\n`, "\r", `\r`, "\t", `\t`).Replace(s)
}

func runeLen(s string) int { return utf8.RuneCountInString(s) }

func truncate(s string, w int) string {
	if runeLen(s) <= w {
		return s
	}
	if w <= 1 {
		return "…"
	}
	r := []rune(s)
	return string(r[:w-1]) + "…"
}

func pad(s string, w int, right bool) string {
	n := w - runeLen(s)
	if n <= 0 {
		return s
	}
	if right {
		return strings.Repeat(" ", n) + s
	}
	return s + strings.Repeat(" ", n)
}

func styleHeader(c exec.Column, text string, styled bool) string {
	if !styled {
		return text
	}
	switch c.Kind {
	case "partition":
		return "\x1b[1m" + text + "\x1b[0m"
	case "clustering":
		return "\x1b[4m" + text + "\x1b[0m"
	}
	return text
}

// RenderTable draws a box-drawn grid sized to opts.Width.
func RenderTable(w io.Writer, cols []exec.Column, rows [][]Cell, opts TableOptions) {
	widths := make([]int, len(cols))
	for i, c := range cols {
		widths[i] = runeLen(c.Name)
	}
	texts := make([][]string, len(rows))
	for i, r := range rows {
		texts[i] = make([]string, len(r))
		for j, c := range r {
			t := oneLine(c.Text)
			texts[i][j] = t
			if n := runeLen(t); n > widths[j] {
				widths[j] = n
			}
		}
	}
	fit(widths, opts.Width)

	line := func(l, m, r string) {
		parts := make([]string, len(widths))
		for i, n := range widths {
			parts[i] = strings.Repeat("─", n+2)
		}
		fmt.Fprintln(w, l+strings.Join(parts, m)+r)
	}
	line("┌", "┬", "┐")
	hdr := make([]string, len(cols))
	for i, c := range cols {
		name := truncate(c.Name, widths[i])
		hdr[i] = " " + styleHeader(c, name, opts.Styled) + strings.Repeat(" ", widths[i]-runeLen(name)) + " "
	}
	fmt.Fprintln(w, "│"+strings.Join(hdr, "│")+"│")
	line("├", "┼", "┤")
	for _, r := range texts {
		parts := make([]string, len(r))
		for j, t := range r {
			parts[j] = " " + pad(truncate(t, widths[j]), widths[j], numeric(cols[j].Type)) + " "
		}
		fmt.Fprintln(w, "│"+strings.Join(parts, "│")+"│")
	}
	line("└", "┴", "┘")
}

// fit shrinks the widest columns until the grid fits in total (0 = no limit).
func fit(widths []int, total int) {
	if total <= 0 || len(widths) == 0 {
		return
	}
	// Each column costs its width plus two spaces and one border, plus one final border.
	used := func() int {
		n := 1
		for _, x := range widths {
			n += x + 3
		}
		return n
	}
	for used() > total {
		widest := -1
		for i, x := range widths {
			if x > minColWidth && (widest < 0 || x > widths[widest]) {
				widest = i
			}
		}
		if widest < 0 {
			return
		}
		widths[widest]--
	}
}

// RenderExpanded prints one block per row: "@ Row n" then "column | value".
func RenderExpanded(w io.Writer, cols []exec.Column, rows [][]Cell, offset int) {
	nameW := 0
	for _, c := range cols {
		if n := runeLen(c.Name); n > nameW {
			nameW = n
		}
	}
	for i, r := range rows {
		fmt.Fprintf(w, "@ Row %d\n", offset+i+1)
		for j, c := range r {
			lines := strings.Split(strings.ReplaceAll(c.Text, "\r\n", "\n"), "\n")
			fmt.Fprintf(w, " %s | %s\n", pad(cols[j].Name, nameW, false), lines[0])
			for _, l := range lines[1:] {
				fmt.Fprintf(w, " %s | %s\n", strings.Repeat(" ", nameW), l)
			}
		}
		fmt.Fprintln(w)
	}
}

// RenderRaw prints tab-separated values, header first on the first page, NULL
// as an empty field. Tabs and line breaks inside values are backslash-escaped
// so that every record stays on one line.
func RenderRaw(w io.Writer, cols []exec.Column, rows [][]Cell, header bool) {
	esc := strings.NewReplacer("\t", `\t`, "\n", `\n`, "\r", `\r`)
	if header {
		names := make([]string, len(cols))
		for i, c := range cols {
			names[i] = esc.Replace(c.Name)
		}
		fmt.Fprintln(w, strings.Join(names, "\t"))
	}
	for _, r := range rows {
		parts := make([]string, len(r))
		for j, c := range r {
			if !c.Null {
				parts[j] = esc.Replace(c.Text)
			}
		}
		fmt.Fprintln(w, strings.Join(parts, "\t"))
	}
}
