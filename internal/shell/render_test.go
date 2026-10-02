package shell

import (
	"bytes"
	"flag"
	"os"
	"path/filepath"
	"testing"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/exec"
)

var update = flag.Bool("update", false, "rewrite golden files")

func golden(t *testing.T, name, got string) {
	t.Helper()
	path := filepath.Join("testdata", name+".golden")
	if *update {
		if err := os.MkdirAll("testdata", 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(want) != got {
		t.Errorf("%s mismatch\n--- want\n%s\n--- got\n%s", name, want, got)
	}
}

func fixtureColumns() []exec.Column {
	return []exec.Column{
		{Name: "merchant_id", Type: txt(), Kind: "partition"},
		{Name: "txn_time", Type: codec.TypeDesc{Name: "timestamp"}, Kind: "clustering", Order: "DESC"},
		{Name: "amount", Type: codec.TypeDesc{Name: "decimal"}, Kind: "regular"},
		{Name: "tags", Type: codec.TypeDesc{Name: "set", Args: []codec.TypeDesc{txt()}}, Kind: "regular"},
		{Name: "note", Type: txt(), Kind: "regular"},
	}
}

func fixtureRows() [][]Cell {
	return [][]Cell{
		{{Text: "m-1001"}, {Text: "2026-03-01 10:15:00.000Z"}, {Text: "12.50"}, {Text: "{'a', 'b'}"}, {Text: "paid\nby card"}},
		{{Text: "m-1002"}, {Text: "2026-03-02 08:00:00.000Z"}, {Text: "7"}, {Text: "{}"}, {Text: "null", Null: true}},
		{{Text: "m-ünï-1003"}, {Text: "2026-03-03 23:59:59.999Z"}, {Text: "1234567.89"}, {Text: "{'x'}"}, {Text: "a very long note that will not fit in a narrow terminal window at all"}},
	}
}

func firstCols(rows [][]Cell, n, count int) [][]Cell {
	var out [][]Cell
	for _, r := range rows[:count] {
		out = append(out, r[:n])
	}
	return out
}

func TestRenderGolden(t *testing.T) {
	cols, rows := fixtureColumns(), fixtureRows()
	var b bytes.Buffer
	cases := map[string]func(){
		"table_wide":     func() { RenderTable(&b, cols, rows, TableOptions{}) },
		"table_narrow":   func() { RenderTable(&b, cols, rows, TableOptions{Width: 70}) },
		"table_styled":   func() { RenderTable(&b, cols[:2], firstCols(rows, 2, 2), TableOptions{Styled: true}) },
		"table_no_rows":  func() { RenderTable(&b, cols[:2], nil, TableOptions{}) },
		"expanded":       func() { RenderExpanded(&b, cols, rows, 0) },
		"expanded_paged": func() { RenderExpanded(&b, cols[:2], firstCols(rows, 2, 1), 100) },
		"raw":            func() { RenderRaw(&b, cols, rows, true) },
		"raw_no_header":  func() { RenderRaw(&b, cols, rows[:1], false) },
	}
	for name, f := range cases {
		b.Reset()
		f()
		golden(t, name, b.String())
	}
}

func TestTableFitsWidth(t *testing.T) {
	for _, w := range []int{40, 55, 70, 100} {
		var b bytes.Buffer
		RenderTable(&b, fixtureColumns(), fixtureRows(), TableOptions{Width: w})
		for _, line := range bytes.Split(b.Bytes(), []byte("\n")) {
			if n := len([]rune(string(line))); n > w && w >= 55 {
				t.Errorf("width %d: line has %d columns: %s", w, n, line)
			}
		}
	}
}

func TestRawKeepsRecordsOnOneLine(t *testing.T) {
	var b bytes.Buffer
	RenderRaw(&b, fixtureColumns(), fixtureRows(), true)
	if n := bytes.Count(b.Bytes(), []byte("\n")); n != 4 {
		t.Errorf("lines = %d, want header + 3 rows", n)
	}
}
