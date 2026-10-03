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
	// Code marks CQL text, which is syntax highlighted in styled tables.
	Code bool
}

// render prints one page. offset is the number of rows already printed and
// first reports whether this is the first page of the statement.
func (s *Shell) render(res *exec.Result, rows [][]Cell, offset int, first bool) {
	switch s.Format {
	case "expanded":
		RenderExpandedStyled(s.Out, res.Columns, rows, offset, s.Styled)
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

// ANSI styling for tables. Only used when TableOptions.Styled is set.
const (
	ansiReset  = "\x1b[0m"
	ansiDim    = "\x1b[90m"
	ansiHeader = "\x1b[36m"
	ansiNull   = "\x1b[2;3m"
	ansiNumber = "\x1b[33m"
	ansiBool   = "\x1b[35m"
	ansiID     = "\x1b[32m"
	ansiTime   = "\x1b[34m"
)

func paint(code, text string, styled bool) string {
	if !styled || text == "" {
		return text
	}
	return code + text + ansiReset
}

// styleHeader colors a column name; partition keys are bold and clustering keys underlined.
func styleHeader(c exec.Column, text string, styled bool) string {
	if !styled {
		return text
	}
	switch c.Kind {
	case "partition":
		return paint(ansiHeader+"\x1b[1m", text, true)
	case "clustering":
		return paint(ansiHeader+"\x1b[4m", text, true)
	}
	return paint(ansiHeader, text, true)
}

// styleCell colors a value by its CQL type; nulls are dimmed.
func styleCell(td codec.TypeDesc, c Cell, text string, styled bool) string {
	if !styled {
		return text
	}
	switch {
	case c.Null:
		return paint(ansiNull, text, true)
	case c.Code:
		return highlightCQL(text, true)
	case numeric(td):
		return paint(ansiNumber, text, true)
	}
	switch td.Name {
	case "boolean":
		return paint(ansiBool, text, true)
	case "uuid", "timeuuid":
		return paint(ansiID, text, true)
	case "timestamp", "date", "time", "duration":
		return paint(ansiTime, text, true)
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
	cellsOf := rows
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
		fmt.Fprintln(w, paint(ansiDim, l+strings.Join(parts, m)+r, opts.Styled))
	}
	bar := paint(ansiDim, "│", opts.Styled)
	line("┌", "┬", "┐")
	hdr := make([]string, len(cols))
	for i, c := range cols {
		name := truncate(c.Name, widths[i])
		hdr[i] = " " + styleHeader(c, name, opts.Styled) + strings.Repeat(" ", widths[i]-runeLen(name)) + " "
	}
	fmt.Fprintln(w, bar+strings.Join(hdr, bar)+bar)
	line("├", "┼", "┤")
	for i, r := range texts {
		parts := make([]string, len(r))
		for j, t := range r {
			t = truncate(t, widths[j])
			padded := pad(t, widths[j], numeric(cols[j].Type))
			if opts.Styled {
				padded = strings.Replace(padded, t, styleCell(cols[j].Type, cellsOf[i][j], t, true), 1)
			}
			parts[j] = " " + padded + " "
		}
		fmt.Fprintln(w, bar+strings.Join(parts, bar)+bar)
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
	RenderExpandedStyled(w, cols, rows, offset, false)
}

// RenderExpandedStyled is RenderExpanded with colors: dim row headers, colored column names and
// values styled by type like the table renderer.
func RenderExpandedStyled(w io.Writer, cols []exec.Column, rows [][]Cell, offset int, styled bool) {
	nameW := 0
	for _, c := range cols {
		if n := runeLen(c.Name); n > nameW {
			nameW = n
		}
	}
	for i, r := range rows {
		fmt.Fprintln(w, paint(ansiDim+"\x1b[1m", fmt.Sprintf("@ Row %d", offset+i+1), styled))
		for j, c := range r {
			lines := strings.Split(strings.ReplaceAll(c.Text, "\r\n", "\n"), "\n")
			bar := paint(ansiDim, "|", styled)
			name := styleHeader(cols[j], cols[j].Name, styled) + strings.Repeat(" ", nameW-runeLen(cols[j].Name))
			fmt.Fprintf(w, " %s %s %s\n", name, bar, styleCell(cols[j].Type, c, lines[0], styled))
			for _, l := range lines[1:] {
				fmt.Fprintf(w, " %s %s %s\n", strings.Repeat(" ", nameW), bar, styleCell(cols[j].Type, c, l, styled))
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
