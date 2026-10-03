package shell

import (
	"fmt"
	"strconv"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/exec"
)

// printTable prints text rows as a grid like a query result: the first column is bold, columns
// of whole numbers are right-aligned and colored, and everything fits the terminal width.
func (s *Shell) printTable(head []string, rows [][]string) { s.printCodeTable(head, rows, nil) }

// printCodeTable is printTable with the columns in code holding CQL, which is highlighted.
func (s *Shell) printCodeTable(head []string, rows [][]string, code map[int]bool) {
	cols := make([]exec.Column, len(head))
	for i, h := range head {
		cols[i] = exec.Column{Name: h, Type: codec.TypeDesc{Name: columnType(rows, i)}}
		if i == 0 {
			cols[i].Kind = "partition"
		}
	}
	cells := make([][]Cell, len(rows))
	for i, r := range rows {
		cells[i] = make([]Cell, len(r))
		for j, v := range r {
			cells[i][j] = Cell{Text: v, Code: code[j]}
		}
	}
	RenderTable(s.Out, cols, cells, TableOptions{Width: s.width(), Styled: s.Styled})
}

// footer prints a dimmed line such as "(3 rows)" after a blank line.
func (s *Shell) footer(text string) {
	fmt.Fprintf(s.Out, "\n%s\n", paint(ansiDim, text, s.Styled))
}

// code prints CQL (or any DDL) with syntax highlighting when styled.
func (s *Shell) code(text string) {
	fmt.Fprint(s.Out, highlightCQL(text, s.Styled))
}

// columnType is "int" when every value in column i is a whole number (so the column is
// right-aligned and colored like a number), else "text".
func columnType(rows [][]string, i int) string {
	if len(rows) == 0 {
		return "text"
	}
	for _, r := range rows {
		if _, err := strconv.Atoi(r[i]); err != nil {
			return "text"
		}
	}
	return "int"
}
