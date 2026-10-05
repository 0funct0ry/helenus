package export

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/exec"
)

func td(n string, args ...codec.TypeDesc) codec.TypeDesc { return codec.TypeDesc{Name: n, Args: args} }

var fixCols = []exec.Column{
	{Name: "id", Type: td("int")}, {Name: "name", Type: td("text")}, {Name: "m", Type: td("map", td("text"), td("int"))},
	{Name: "ts", Type: td("timestamp")}, {Name: "n", Type: td("text")},
}

var fixTime = time.Date(2024, 3, 5, 10, 20, 30, 0, time.UTC)

func fixRows() [][]any {
	return [][]any{
		{1, "a,b \"q\"", codec.Map{Keys: []any{"x"}, Values: []any{1}}, fixTime, nil},
		{2, "plain", nil, nil, "z"},
	}
}

type pagedRunner struct {
	rows  [][]any
	size  int
	calls int
	reqs  []exec.Request
	fail  error
}

func (p *pagedRunner) Run(_ context.Context, req exec.Request) (*exec.Result, error) {
	p.calls++
	p.reqs = append(p.reqs, req)
	if p.fail != nil {
		return nil, p.fail
	}
	start := 0
	if len(req.PageState) > 0 {
		start = int(req.PageState[0])
	}
	end := min(start+p.size, len(p.rows))
	res := &exec.Result{Kind: exec.KindRows, Columns: fixCols, Raw: p.rows[start:end]}
	if end < len(p.rows) {
		res.HasMore = true
		res.PageState = base64.StdEncoding.EncodeToString([]byte{byte(end)})
	}
	return res, nil
}

func render(t *testing.T, format string, o Options) string {
	t.Helper()
	var buf bytes.Buffer
	w, err := NewWriter(format, &buf, o, nil)
	if err != nil {
		t.Fatal(err)
	}
	n, err := Run(context.Background(), &pagedRunner{rows: fixRows(), size: 1}, Source{Query: "SELECT * FROM ks.t"}, Config{}, w)
	if err != nil || n != 2 {
		t.Fatalf("run: n=%d err=%v", n, err)
	}
	return buf.String()
}

func TestCSV(t *testing.T) {
	got := render(t, CSV, Options{Header: true, NullString: "NULL"})
	want := "id,name,m,ts,n\r\n1,\"a,b \"\"q\"\"\",{'x': 1},2024-03-05 10:20:30.000Z,NULL\r\n2,plain,NULL,NULL,z\r\n"
	if got != want {
		t.Fatalf("got %q\nwant %q", got, want)
	}
	got = render(t, CSV, Options{Delimiter: ";", DateTimeFormat: "%Y/%m/%d"})
	if !strings.Contains(got, "1;\"a,b \"\"q\"\"\";{'x': 1};2024/03/05;\r\n") || strings.Contains(got, "id;") {
		t.Fatalf("got %q", got)
	}
}

func TestJSONMatchesCodecForm(t *testing.T) {
	got := render(t, JSON, Options{})
	want := "[\n{\"id\":1,\"name\":\"a,b \\\"q\\\"\",\"m\":[[\"x\",1]],\"ts\":\"2024-03-05T10:20:30.000Z\",\"n\":null},\n" +
		"{\"id\":2,\"name\":\"plain\",\"m\":null,\"ts\":null,\"n\":\"z\"}\n]\n"
	if got != want {
		t.Fatalf("got %q\nwant %q", got, want)
	}
	if got := render(t, NDJSON, Options{}); strings.Count(got, "\n") != 2 || strings.HasPrefix(got, "[") {
		t.Fatalf("ndjson %q", got)
	}
}

func TestXMLAndCQL(t *testing.T) {
	x := render(t, XML, Options{})
	if !strings.Contains(x, `<col name="n" nil="true"/>`) || !strings.Contains(x, `<col name="name">a,b &#34;q&#34;</col>`) || !strings.HasSuffix(x, "</rows>\n") {
		t.Fatalf("xml %q", x)
	}
	c := render(t, CQL, Options{Table: "shop.users"})
	want := "INSERT INTO shop.users (id, name, m, ts, n) VALUES (1, 'a,b \"q\"', {'x': 1}, '2024-03-05 10:20:30.000Z', null);\n"
	if !strings.HasPrefix(c, want) {
		t.Fatalf("cql %q", c)
	}
}

func TestExcel(t *testing.T) {
	var buf bytes.Buffer
	w, _ := NewWriter(Excel, &buf, Options{Header: true}, nil)
	if _, err := Run(context.Background(), &pagedRunner{rows: fixRows(), size: 10}, Source{Query: "SELECT 1"}, Config{}, w); err != nil {
		t.Fatal(err)
	}
	f, err := excelize.OpenReader(&buf)
	if err != nil {
		t.Fatal(err)
	}
	rows, _ := f.GetRows("Sheet1")
	if len(rows) != 3 || rows[0][0] != "id" || rows[2][1] != "plain" {
		t.Fatalf("rows %v", rows)
	}
}

func TestExcelLimitWritesNothing(t *testing.T) {
	var buf bytes.Buffer
	ew := &excelWriter{w: &buf, rows: ExcelMaxRows}
	ew.cols = fixCols
	if err := ew.Row([]any{1, "a", nil, nil, nil}); !errors.Is(err, ErrExcelLimit) {
		t.Fatalf("err %v", err)
	}
	if buf.Len() != 0 {
		t.Fatal("wrote output before failing")
	}
	if ErrExcelLimit.Error() != "Excel allows 1,048,576 rows; use CSV for more" {
		t.Fatal(ErrExcelLimit)
	}
}

func TestPagingAndErrors(t *testing.T) {
	r := &pagedRunner{rows: fixRows(), size: 1}
	var buf bytes.Buffer
	w, _ := NewWriter(CSV, &buf, Options{}, nil)
	if _, err := Run(context.Background(), r, Source{Query: "SELECT 1"}, Config{Consistency: "ONE", PageSize: 1}, w); err != nil {
		t.Fatal(err)
	}
	if r.calls != 2 || r.reqs[0].Consistency != "ONE" || r.reqs[0].PageSize != 1 {
		t.Fatalf("calls=%d reqs=%+v", r.calls, r.reqs)
	}
	r = &pagedRunner{fail: errors.New("boom")}
	w, _ = NewWriter(CSV, &buf, Options{}, nil)
	if _, err := Run(context.Background(), r, Source{Query: "SELECT 1"}, Config{}, w); err == nil || err.Error() != "boom" {
		t.Fatalf("err %v", err)
	}
}

func TestCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var buf bytes.Buffer
	w, _ := NewWriter(CSV, &buf, Options{}, nil)
	if _, err := Run(ctx, &pagedRunner{rows: fixRows(), size: 1}, Source{Query: "SELECT 1"}, Config{}, w); err == nil {
		t.Fatal("expected cancellation error")
	}
}

func TestTokenRangesCoverSpace(t *testing.T) {
	for _, n := range []int{1, 2, 3, 7, 64} {
		rs := TokenRanges(n)
		if len(rs) != n || rs[0][0] != -1<<63 || rs[n-1][1] != 1<<63-1 {
			t.Fatalf("n=%d %v", n, rs)
		}
		for i := 1; i < n; i++ {
			if rs[i][0] != rs[i-1][1]+1 || rs[i][0] > rs[i][1] {
				t.Fatalf("n=%d gap at %d: %v", n, i, rs)
			}
		}
	}
}

func TestRangeSplitStatements(t *testing.T) {
	r := &pagedRunner{rows: fixRows(), size: 10}
	var buf bytes.Buffer
	w, _ := NewWriter(CSV, &buf, Options{}, nil)
	n, err := Run(context.Background(), r, Source{Keyspace: "ks", Table: "t", PartitionKey: []string{"a", "B"}},
		Config{Ranges: 4, Concurrency: 2}, w)
	if err != nil || n != 8 {
		t.Fatalf("n=%d err=%v", n, err)
	}
	if !strings.Contains(r.reqs[0].CQL, `WHERE token(a, "B") >= ? AND token(a, "B") <= ?`) || len(r.reqs[0].Args) != 2 {
		t.Fatalf("%+v", r.reqs[0])
	}
	if _, err := Run(context.Background(), r, Source{Query: "SELECT 1"}, Config{Ranges: 2}, w); err == nil {
		t.Fatal("query + ranges must fail")
	}
}

func TestStatementAndOptions(t *testing.T) {
	s := Source{Keyspace: "Shop", Table: "users", Columns: []string{"id", "e-mail"}, Where: "id = 1"}
	if got := s.Statement(); got != `SELECT id, "e-mail" FROM "Shop".users WHERE id = 1` {
		t.Fatal(got)
	}
	if err := (Options{Delimiter: "ab"}).Validate(CSV); err == nil {
		t.Fatal("multi-char delimiter accepted")
	}
	if err := (Options{}).Validate("yaml"); err == nil {
		t.Fatal("unknown format accepted")
	}
}

func TestThrottle(t *testing.T) {
	var buf bytes.Buffer
	w, _ := NewWriter(CSV, &buf, Options{}, nil)
	start := time.Now()
	if _, err := Run(context.Background(), &pagedRunner{rows: fixRows(), size: 10}, Source{Query: "SELECT 1"}, Config{RowsPerSecond: 10}, w); err != nil {
		t.Fatal(err)
	}
	if time.Since(start) < 150*time.Millisecond {
		t.Fatalf("not throttled: %v", time.Since(start))
	}
}
