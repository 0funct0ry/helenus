package export

import (
	"io"

	"github.com/xuri/excelize/v2"

	"github.com/0funct0ry/helenus/internal/exec"
)

// excelWriter streams one sheet. Nothing reaches w until End, so a failure such
// as the row limit never leaves a partial workbook behind.
type excelWriter struct {
	cells
	w    io.Writer
	o    Options
	f    *excelize.File
	sw   *excelize.StreamWriter
	next int
	rows int
}

func (e *excelWriter) Begin(cols []exec.Column) error {
	e.cols = cols
	e.f = excelize.NewFile()
	sw, err := e.f.NewStreamWriter("Sheet1")
	if err != nil {
		return err
	}
	e.sw, e.next = sw, 1
	if !e.o.Header {
		return nil
	}
	bold, err := e.f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
	if err != nil {
		return err
	}
	cells := make([]any, len(cols))
	for i, c := range cols {
		cells[i] = excelize.Cell{Value: c.Name, StyleID: bold}
	}
	return e.put(cells)
}

func (e *excelWriter) put(cells []any) error {
	ref, err := excelize.CoordinatesToCellName(1, e.next)
	if err != nil {
		return err
	}
	e.next++
	return e.sw.SetRow(ref, cells)
}

func (e *excelWriter) Row(raw []any) error {
	if e.rows >= ExcelMaxRows {
		return ErrExcelLimit
	}
	e.rows++
	out := make([]any, len(raw))
	for i, v := range raw {
		switch x := v.(type) {
		case nil:
			out[i] = nil
		case int8, int16, int32, int, float32, float64, bool:
			out[i] = x
		default:
			s, _ := e.text(i, v)
			out[i] = s
		}
	}
	return e.put(out)
}

func (e *excelWriter) End() error {
	if e.sw == nil {
		return nil
	}
	if err := e.sw.Flush(); err != nil {
		return err
	}
	defer func() { _ = e.f.Close() }()
	return e.f.Write(e.w)
}
