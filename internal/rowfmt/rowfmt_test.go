package rowfmt

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/exec"
)

func col(name, typ, kind string, pos int) exec.Column {
	return exec.Column{Name: name, Type: codec.TypeDesc{Name: typ}, Kind: kind, Position: pos}
}

func rows(rs ...[]string) [][]json.RawMessage {
	var out [][]json.RawMessage
	for _, r := range rs {
		var row []json.RawMessage
		for _, v := range r {
			row = append(row, json.RawMessage(v))
		}
		out = append(out, row)
	}
	return out
}

func sample() Request {
	return Request{
		Source:  &Source{Keyspace: "ks", Table: "Tbl"},
		Columns: []exec.Column{col("id", "int", "partition", 0), col("name", "text", "regular", 0), col("note", "text", "regular", 0), col("blob", "blob", "regular", 0)},
		Rows: rows(
			[]string{`1`, `"a,b"`, `null`, `"0x0aff"`},
			[]string{`2`, `"it's \"q\"\nline|x"`, `"<t>&"`, `null`},
		),
	}
}

func TestFormats(t *testing.T) {
	want := map[string]string{
		"json":        "[\n  {\n    \"id\": 1,\n    \"name\": \"a,b\",\n    \"note\": null,\n    \"blob\": \"0x0aff\"\n  },\n  {\n    \"id\": 2,\n    \"name\": \"it's \\\"q\\\"\\nline|x\",\n    \"note\": \"<t>&\",\n    \"blob\": null\n  }\n]",
		"csv":         "id,name,note,blob\n1,\"a,b\",,0x0aff\n2,\"it's \"\"q\"\"\nline|x\",<t>&,",
		"tsv":         "id\tname\tnote\tblob\n1\ta,b\t\t0x0aff\n2\tit's \"q\"\\nline|x\t<t>&\t",
		"markdown":    "| id | name | note | blob |\n| --- | --- | --- | --- |\n| 1 | a,b |  | 0x0aff |\n| 2 | it's \"q\"<br>line\\|x | <t>& |  |",
		"sql_inserts": "INSERT INTO ks.\"Tbl\" (id, name, note, blob) VALUES (1, 'a,b', null, 0x0aff);\nINSERT INTO ks.\"Tbl\" (id, name, note, blob) VALUES (2, 'it''s \"q\"\nline|x', '<t>&', null);",
		"sql_updates": "UPDATE ks.\"Tbl\" SET name = 'a,b', note = null, blob = 0x0aff WHERE id = 1;\nUPDATE ks.\"Tbl\" SET name = 'it''s \"q\"\nline|x', note = '<t>&', blob = null WHERE id = 2;",
		"where":       "id = 1\nid = 2",
	}
	for f, w := range want {
		req := sample()
		req.Format = f
		got, err := Format(req)
		if err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		if got != w {
			t.Errorf("%s:\n got %q\nwant %q", f, got, w)
		}
	}
}

func TestXMLHTMLYAML(t *testing.T) {
	req := sample()
	req.Format = "xml"
	got, _ := Format(req)
	if want := "<rows>\n<row><col name=\"id\">1</col><col name=\"name\">a,b</col><col name=\"note\" nil=\"true\"/><col name=\"blob\">0x0aff</col></row>\n"; got[:len(want)] != want {
		t.Errorf("xml: %q", got)
	}
	req.Format = "html"
	got, _ = Format(req)
	for _, s := range []string{`<td class="null"></td>`, "<td>&lt;t&gt;&amp;</td>", "<thead>"} {
		if !contains(got, s) {
			t.Errorf("html missing %q in %q", s, got)
		}
	}
	req.Format = "yaml"
	got, _ = Format(req)
	for _, s := range []string{"- id: 1\n", "  note: null\n", `name: a,b`} {
		if !contains(got, s) {
			t.Errorf("yaml missing %q in %q", s, got)
		}
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func TestCollectionsAndUDT(t *testing.T) {
	cols := []exec.Column{
		col("k", "int", "partition", 0),
		{Name: "l", Type: codec.TypeDesc{Name: "list", Args: []codec.TypeDesc{{Name: "int"}}}},
		{Name: "m", Type: codec.TypeDesc{Name: "map", Args: []codec.TypeDesc{{Name: "text"}, {Name: "int"}}}},
	}
	req := Request{Format: "sql_inserts", Source: &Source{Table: "t"}, Columns: cols, Rows: rows([]string{`1`, `[1,2]`, `[["a",1]]`})}
	got, err := Format(req)
	if err != nil || got != "INSERT INTO t (k, l, m) VALUES (1, [1, 2], {'a': 1});" {
		t.Fatalf("%q %v", got, err)
	}
	req.Format = "yaml"
	if _, err := Format(req); err != nil {
		t.Fatal(err)
	}
}

func TestCompositeKeyOrderAndDisabled(t *testing.T) {
	cols := []exec.Column{col("v", "text", "regular", 0), col("ck", "text", "clustering", 0), col("pk2", "int", "partition", 1), col("pk1", "int", "partition", 0)}
	req := Request{Format: "where", Source: &Source{Keyspace: "ks", Table: "t"}, Columns: cols, Rows: rows([]string{`"x"`, `"a"`, `2`, `1`}, []string{`"y"`, `"b"`, `4`, `3`})}
	got, err := Format(req)
	if err != nil || got != "pk1 = 1 AND pk2 = 2 AND ck = 'a'\npk1 = 3 AND pk2 = 4 AND ck = 'b'" {
		t.Fatalf("%q %v", got, err)
	}
	var de *DisabledError
	req.Source = nil
	if _, err := Format(req); !errors.As(err, &de) {
		t.Errorf("no source: %v", err)
	}
	req.Source = &Source{Table: "t"}
	req.Format = "sql_updates"
	req.Counter = true
	if _, err := Format(req); !errors.As(err, &de) {
		t.Errorf("counter: %v", err)
	}
	req.Counter = false
	req.Columns = cols[1:2]
	req.Rows = rows([]string{`"a"`})
	if _, err := Format(req); !errors.As(err, &de) {
		t.Errorf("no partition: %v", err)
	}
	if _, err := Format(Request{Format: "nope"}); !errors.Is(err, ErrUnknownFormat) {
		t.Errorf("unknown: %v", err)
	}
}

func TestAggregateExample(t *testing.T) {
	// 7 rows x 7 numeric columns would be long; use values whose figures are known.
	cols := []exec.Column{col("a", "decimal", "", 0), col("b", "decimal", "", 0), col("s", "text", "", 0)}
	req := AggregateRequest{Columns: cols, Rows: rows(
		[]string{`"1.5"`, `"2.5"`, `"x"`},
		[]string{`"3"`, `null`, `null`},
		[]string{`"4"`, `"10"`, `"y"`},
	)}
	res, err := Aggregate(req)
	if err != nil {
		t.Fatal(err)
	}
	want := "AVG: 4.2\nCOEFFICIENT_OF_VARIATION: 71.67%\nCOLS: 3\nCOUNT: 7\nCOUNT_NUMS: 5\nMAX: 10\nMEDIAN: 3\nMIN: 1.5\nROWS: 3\nSUM: 21"
	if res.Text != want {
		t.Errorf("got\n%s\nwant\n%s", res.Text, want)
	}
}

func TestAggregateAvgPrecisionAndEmpty(t *testing.T) {
	// 2492.36 / 7 rounded to 34 significant digits.
	cols := []exec.Column{col("a", "decimal", "", 0)}
	req := AggregateRequest{Columns: cols, Rows: rows([]string{`"2492.36"`}, []string{`"0"`}, []string{`"0"`}, []string{`"0"`}, []string{`"0"`}, []string{`"0"`}, []string{`"0"`})}
	res, _ := Aggregate(req)
	for _, l := range res.Lines {
		if l.Key == "AVG" && l.Value != "356.0514285714285714285714285714286" {
			t.Errorf("AVG %s", l.Value)
		}
	}
	res, _ = Aggregate(AggregateRequest{Columns: []exec.Column{col("s", "text", "", 0)}, Rows: rows([]string{`"x"`})})
	for _, l := range res.Lines {
		switch l.Key {
		case "AVG", "SUM", "MIN", "MAX", "MEDIAN", "COEFFICIENT_OF_VARIATION":
			if l.Value != Dash {
				t.Errorf("%s = %s", l.Key, l.Value)
			}
		}
	}
}

func TestAggregateSpecialAndZeroAvg(t *testing.T) {
	cols := []exec.Column{col("d", "double", "", 0)}
	res, _ := Aggregate(AggregateRequest{Columns: cols, Rows: rows([]string{`"NaN"`}, []string{`"Infinity"`}, []string{`-1`}, []string{`1`})})
	m := map[string]string{}
	for _, l := range res.Lines {
		m[l.Key] = l.Value
	}
	if m["COUNT_NUMS"] != "2" || m["COUNT"] != "4" || m["AVG"] != "0" || m["COEFFICIENT_OF_VARIATION"] != Dash {
		t.Errorf("%v", m)
	}
}
