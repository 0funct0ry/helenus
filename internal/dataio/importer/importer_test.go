package importer

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/dataio/detect"
	"github.com/0funct0ry/helenus/internal/schema"
)

func td(s string) codec.TypeDesc {
	d, err := codec.Parse(s, "ks")
	if err != nil {
		panic(err)
	}
	return d
}

func usersTable() schema.Table {
	return schema.Table{Keyspace: "shop", Name: "users", Columns: []schema.Column{
		{Name: "user_id", Type: td("int"), Kind: schema.KindPartition, Position: 1},
		{Name: "email", Type: td("text"), Kind: schema.KindRegular},
		{Name: "age", Type: td("int"), Kind: schema.KindRegular},
	}}
}

func open(t *testing.T, text string, f Format) *Reader {
	t.Helper()
	rd, err := Open(strings.NewReader(text), f)
	if err != nil {
		t.Fatal(err)
	}
	return rd
}

func drain(t *testing.T, rd *Reader) []Record {
	t.Helper()
	var out []Record
	for {
		rec, err := rd.Next()
		if err == io.EOF {
			return out
		}
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, rec)
	}
}

func TestCSVReaderBOMCRLFHeaderAndLines(t *testing.T) {
	rd := open(t, "\ufeffid;note\r\n1;\"a\r\nb\"\r\n2;\r\n3;x;y\r\n", Format{Kind: detect.CSV, Delimiter: ";", Header: true})
	if got := strings.Join(rd.Columns(), ","); got != "id,note" {
		t.Fatalf("columns %s", got)
	}
	recs := drain(t, rd)
	if len(recs) != 3 || recs[0].Line != 2 || recs[1].Line != 4 || recs[2].Line != 5 {
		t.Fatalf("%+v", recs)
	}
	if recs[0].Vals["note"] != "a\nb" || recs[1].Vals["note"] != nil || recs[2].Err == nil {
		t.Fatalf("%+v", recs)
	}
	rd = open(t, "1,a\n2,b\n", Format{Kind: detect.CSV})
	if strings.Join(rd.Columns(), ",") != "column1,column2" || len(drain(t, rd)) != 2 {
		t.Fatal("headerless")
	}
}

func TestJSONReaders(t *testing.T) {
	rd := open(t, `[{"a":1,"b":{"x":2}},{"a":2,"c":true}]`, Format{Kind: detect.JSON})
	if strings.Join(rd.Columns(), ",") != "a,b,c" || len(drain(t, rd)) != 2 {
		t.Fatalf("%v", rd.Columns())
	}
	rd = open(t, "{\"a\":1}\n\nnot json\n{\"a\":3}\n", Format{Kind: detect.NDJSON})
	recs := drain(t, rd)
	if len(recs) != 3 || recs[1].Err == nil || recs[2].Line != 4 {
		t.Fatalf("%+v", recs)
	}
	if _, err := Open(strings.NewReader(`{"a":1}`), Format{Kind: detect.JSON}); err == nil {
		t.Fatal("a JSON object is not an array")
	}
}

func TestConvert(t *testing.T) {
	udt := func(codec.UDTRef) map[string]codec.TypeDesc {
		return map[string]codec.TypeDesc{"street": td("text"), "tags": td("map<text,int>")}
	}
	addr := codec.TypeDesc{Name: "address", UDT: &codec.UDTRef{Keyspace: "ks", Name: "address"}}
	for _, tc := range []struct {
		in   any
		typ  codec.TypeDesc
		want string
	}{
		{"42", td("int"), "42"},
		{"TRUE", td("boolean"), "true"},
		{"2024-01-02 03:04:05+0000", td("timestamp"), "2024-01-02 03:04:05 +0000 UTC"},
		{"[1, 2]", td("list<int>"), "[1 2]"},
		{"{1, 2}", td("set<int>"), "[1 2]"},
		{"{'a': 1}", td("map<text,int>"), "map[a:1]"},
		{`{"a": 1}`, td("map<text,int>"), "map[a:1]"},
		{"(1, 'x')", td("tuple<int,text>"), "[1 x]"},
		{"{street: 'Main', tags: {'k': 2}}", addr, "map[street:Main tags:map[k:2]]"},
	} {
		got, err := Convert(tc.in, tc.typ, udt)
		if err != nil || fmt.Sprint(got) != tc.want {
			t.Errorf("%v as %s: %v %v, want %s", tc.in, tc.typ.Name, got, err, tc.want)
		}
	}
	// Nested JSON objects load into a UDT, with maps inside given as objects.
	rd := open(t, `{"u":{"street":"Main","tags":{"k":2}}}`+"\n", Format{Kind: detect.NDJSON})
	got, err := Convert(drain(t, rd)[0].Vals["u"], addr, udt)
	if err != nil || fmt.Sprint(got) != "map[street:Main tags:map[k:2]]" {
		t.Fatalf("%v %v", got, err)
	}
	for in, typ := range map[string]codec.TypeDesc{"x": td("int"), "maybe": td("boolean"), "{1": td("set<int>"), "[1,": td("list<int>")} {
		if _, err := Convert(in, typ, udt); err == nil {
			t.Errorf("%q as %s should fail", in, typ.Name)
		}
	}
}

type fakeEx struct {
	mu    sync.Mutex
	calls []string
	args  [][]any
	fn    func(n int, cql string) error
}

func (f *fakeEx) Exec(_ context.Context, cql string, args []any, _ string) error {
	f.mu.Lock()
	f.calls = append(f.calls, cql)
	f.args = append(f.args, args)
	n := len(f.calls)
	f.mu.Unlock()
	if f.fn != nil {
		return f.fn(n, cql)
	}
	return nil
}

func job() Job {
	return Job{Table: usersTable(), Mapping: []Mapping{{"user_id", "id"}, {"email", "mail"}, {"age", ""}}}
}

func TestRunRejectsBadRowsWithReport(t *testing.T) {
	rd := open(t, "id,mail\n1,a@x\nx,b@x\n3,c@x\n,d@x\n5,e@x,extra\n", Format{Kind: detect.CSV, Delimiter: ",", Header: true})
	var errs bytes.Buffer
	ex := &fakeEx{}
	res, err := job().Run(context.Background(), ex, rd, &errs, 0, nil)
	if err != nil || res.Written != 2 || res.Rejected != 3 || res.Rows != 5 {
		t.Fatalf("%+v %v", res, err)
	}
	want := []string{
		"line,column,value,reason,record",
		`3,user_id,x,int: expected an integer,x,b@x`,
		`5,user_id,,primary key column cannot be empty,,d@x`,
		`6,,,"expected 2 fields, found 3",5,e@x,extra`,
	}
	got := strings.Split(strings.TrimSpace(errs.String()), "\n")
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("error file:\n%s", errs.String())
	}
	if ex.calls[0] != "INSERT INTO shop.users (user_id, email) VALUES (?, ?)" {
		t.Fatal(ex.calls[0])
	}
	// A clean import writes no error file content.
	errs.Reset()
	rd = open(t, "1,a\n", Format{Kind: detect.CSV})
	j := job()
	j.Mapping = []Mapping{{"user_id", "column1"}, {"email", "column2"}}
	if _, err := j.Run(context.Background(), &fakeEx{}, rd, &errs, 0, nil); err != nil || errs.Len() != 0 {
		t.Fatalf("%v %q", err, errs.String())
	}
}

func TestBatchingGroupsOnePartition(t *testing.T) {
	rd := open(t, "1,a\n1,b\n1,c\n2,d\n", Format{Kind: detect.CSV})
	j := job()
	j.Mapping = []Mapping{{"user_id", "column1"}, {"email", "column2"}}
	j.Opts = Options{BatchSize: 2, Concurrency: 1}
	ex := &fakeEx{}
	res, err := j.Run(context.Background(), ex, rd, nil, 0, nil)
	if err != nil || res.Written != 4 || len(ex.calls) != 3 {
		t.Fatalf("%+v %v %q", res, err, ex.calls)
	}
	if !strings.HasPrefix(ex.calls[0], "BEGIN UNLOGGED BATCH INSERT") || !strings.HasSuffix(ex.calls[0], "; APPLY BATCH") || len(ex.args[0]) != 4 {
		t.Fatalf("%q %v", ex.calls[0], ex.args[0])
	}
	if strings.Contains(ex.calls[2], "BATCH") || len(ex.args[2]) != 2 {
		t.Fatalf("a lone row is not a batch: %q", ex.calls[2])
	}
}

func TestRetriesOnlyTransientFailures(t *testing.T) {
	retryDelay = time.Millisecond
	j := job()
	j.Mapping = []Mapping{{"user_id", "column1"}, {"email", "column2"}}
	ex := &fakeEx{fn: func(n int, _ string) error {
		if n < 3 {
			return errors.New("Operation timed out - received only 0 responses")
		}
		return nil
	}}
	res, err := j.Run(context.Background(), ex, open(t, "1,a\n", Format{Kind: detect.CSV}), nil, 0, nil)
	if err != nil || res.Written != 1 || len(ex.calls) != 3 {
		t.Fatalf("%+v %v %d", res, err, len(ex.calls))
	}
	ex = &fakeEx{fn: func(int, string) error { return errors.New("Invalid query: bad") }}
	res, _ = j.Run(context.Background(), ex, open(t, "1,a\n", Format{Kind: detect.CSV}), nil, 0, nil)
	if res.Rejected != 1 || len(ex.calls) != 1 || !strings.Contains(res.FirstErrs[0].Reason, "Invalid query") {
		t.Fatalf("%+v %d", res, len(ex.calls))
	}
}

func TestMaxErrorsAborts(t *testing.T) {
	var sb strings.Builder
	for i := 0; i < 50; i++ {
		sb.WriteString("x,a\n")
	}
	j := job()
	j.Mapping = []Mapping{{"user_id", "column1"}, {"email", "column2"}}
	j.Opts = Options{MaxErrors: 5}
	res, err := j.Run(context.Background(), &fakeEx{}, open(t, sb.String(), Format{Kind: detect.CSV}), nil, 0, nil)
	if err == nil || !strings.Contains(err.Error(), "aborted") || res.Rejected != 6 {
		t.Fatalf("%+v %v", res, err)
	}
}

func TestValidateAndOptions(t *testing.T) {
	j := job()
	j.Mapping = []Mapping{{"email", "mail"}}
	if err := j.Validate(); err == nil || err.Error() != "Map a source column to user_id" {
		t.Fatalf("%v", err)
	}
	c := usersTable()
	c.Counter = true
	if (Job{Table: c}).Validate() == nil {
		t.Fatal("counter")
	}
	for _, o := range []Options{{Consistency: "any"}, {Concurrency: 65}, {BatchSize: 101}, {TTL: -1}} {
		if _, err := o.Normalized(); err == nil {
			t.Errorf("%+v should be refused", o)
		}
	}
	o, _ := Options{}.Normalized()
	if o.Concurrency != 8 || o.BatchSize != 1 || o.MaxErrors != 1000 || o.Consistency != "LOCAL_QUORUM" {
		t.Fatalf("%+v", o)
	}
	j = job()
	j.Opts = Options{TTL: 60, IfNotExists: true}
	if s, _ := j.Statement(); s != "INSERT INTO shop.users (user_id, email) VALUES (?, ?) IF NOT EXISTS USING TTL 60" {
		t.Fatal(s)
	}
}

func TestCheckAndDryRun(t *testing.T) {
	text := "id,mail\n1,a\nx,b\ny,c\n"
	rd := open(t, text, Format{Kind: detect.CSV, Delimiter: ",", Header: true})
	checks, n, err := job().Check(rd.Peeked())
	if err != nil || n != 3 || checks[0].Target != "user_id" || checks[0].Failures != 2 || checks[1].Failures != 0 {
		t.Fatalf("%+v %d %v", checks, n, err)
	}
	valid, total, errs, err := job().DryRun(rd, 2)
	if err != nil || valid != 1 || total != 2 || len(errs) != 1 {
		t.Fatalf("%d %d %v %v", valid, total, errs, err)
	}
}
