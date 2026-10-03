package shell

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/conn"
	"github.com/0funct0ry/helenus/internal/exec"
	"github.com/0funct0ry/helenus/internal/schema"
	"github.com/0funct0ry/helenus/internal/trace"
)

type fakeDescriber struct {
	got []schema.Target
	ks  string
	err error
	// out replaces the default "DDL for <name>" answer when set.
	out string
}

func (f *fakeDescriber) Describe(_ context.Context, t schema.Target, ks string) (string, error) {
	f.got, f.ks = append(f.got, t), ks
	if f.out != "" {
		return f.out, f.err
	}
	return "DDL for " + t.Name + "\n", f.err
}

// fakeExec answers Run from fn and records every request.
type fakeExec struct {
	reqs []exec.Request
	fn   func(exec.Request) (*exec.Result, error)
}

func (f *fakeExec) Run(_ context.Context, req exec.Request) (*exec.Result, error) {
	f.reqs = append(f.reqs, req)
	if f.fn == nil {
		return &exec.Result{Kind: exec.KindVoid}, nil
	}
	return f.fn(req)
}

func txt() codec.TypeDesc { return codec.TypeDesc{Name: "text"} }
func num() codec.TypeDesc { return codec.TypeDesc{Name: "int"} }

// rows builds a rows result with two columns, id (int, partition key) and name (text).
func rows(vals ...[2]any) *exec.Result {
	r := &exec.Result{
		Kind: exec.KindRows,
		Columns: []exec.Column{
			{Name: "id", Type: num(), Kind: "partition"},
			{Name: "name", Type: txt(), Kind: "regular"},
		},
	}
	for _, v := range vals {
		r.Raw = append(r.Raw, []any{v[0], v[1]})
	}
	return r
}

type harness struct {
	sh   *Shell
	out  *bytes.Buffer
	err  *bytes.Buffer
	ex   *fakeExec
	desc *fakeDescriber
}

func newHarness(fn func(exec.Request) (*exec.Result, error)) *harness {
	h := &harness{out: &bytes.Buffer{}, err: &bytes.Buffer{}, ex: &fakeExec{fn: fn}, desc: &fakeDescriber{}}
	h.sh = &Shell{
		In: strings.NewReader(""), Out: h.out, Err: h.err,
		Backend: Backend{
			Exec: h.ex, Describer: h.desc, Keyspace: "payments", Host: "10.0.0.1", Port: 9042,
			Consistency: "LOCAL_ONE", Serial: "SERIAL",
			Cluster: &conn.ClusterInfo{Name: "Test Cluster", ReleaseVersion: "5.0.2", CQLVersion: "3.4.7", ProtocolVersion: "5"},
		},
		Version: "1.2.3", Format: "table", Paging: 100,
	}
	return h
}

func (h *harness) run(script string) error {
	return h.sh.RunScript(context.Background(), "", script, ScriptOptions{})
}

func TestDescribeForms(t *testing.T) {
	h := newHarness(nil)
	if err := h.run(".describe TABLE payments.merchants;\n.desc keyspaces\n.exit\n"); err != nil {
		t.Fatal(err)
	}
	if h.err.Len() != 0 || !strings.Contains(h.out.String(), "DDL for merchants") {
		t.Fatalf("out=%q err=%q", h.out, h.err)
	}
	if len(h.desc.got) != 2 || h.desc.got[0].Kind != schema.TableT || h.desc.got[1].Kind != schema.Keyspaces {
		t.Errorf("targets = %+v", h.desc.got)
	}
	if h.desc.ks != "payments" {
		t.Errorf("current keyspace not passed: %q", h.desc.ks)
	}
}

func TestDescribeErrorsGoToStderr(t *testing.T) {
	h := newHarness(nil)
	_ = h.run(".describe\n")
	if !strings.Contains(h.err.String(), "SyntaxError") {
		t.Errorf("err = %q", h.err)
	}
	h = newHarness(nil)
	h.desc.err = errors.New("boom")
	_ = h.run(".describe TABLES\n")
	if !strings.Contains(h.err.String(), "Error: boom") {
		t.Errorf("err = %q", h.err)
	}
}

func TestShow(t *testing.T) {
	h := newHarness(nil)
	_ = h.sh.Execute(context.Background(), ".show VERSION")
	_ = h.sh.Execute(context.Background(), ".show HOST;")
	err := h.sh.Execute(context.Background(), ".show NOPE")
	for _, want := range []string{"helenus", "1.2.3", "Cassandra", "5.0.2", "3.4.7", "v5", "Test Cluster", "10.0.0.1", "9042"} {
		if !strings.Contains(h.out.String(), want) {
			t.Errorf("missing %q in %q", want, h.out)
		}
	}
	if err == nil || !strings.Contains(err.Error(), ".show supports") {
		t.Errorf("err = %v", err)
	}
}

func TestQueryRequestCarriesSessionState(t *testing.T) {
	h := newHarness(func(exec.Request) (*exec.Result, error) { return rows([2]any{1, "a"}), nil })
	h.sh.Consistency, h.sh.Serial, h.sh.Paging = "QUORUM", "LOCAL_SERIAL", 25
	if err := h.sh.Execute(context.Background(), "SELECT * FROM t;"); err != nil {
		t.Fatal(err)
	}
	r := h.ex.reqs[0]
	if r.Keyspace != "payments" || r.Consistency != "QUORUM" || r.SerialConsistency != "LOCAL_SERIAL" || r.PageSize != 25 || r.CQL != "SELECT * FROM t;" {
		t.Errorf("request = %+v", r)
	}
	if !strings.Contains(h.out.String(), "(1 row)") {
		t.Errorf("out = %q", h.out)
	}
}

func TestPagingFetchesEveryPage(t *testing.T) {
	pages := [][2]any{{1, "a"}, {2, "b"}, {3, "c"}}
	h := newHarness(func(req exec.Request) (*exec.Result, error) {
		i := 0
		if len(req.PageState) > 0 {
			i = int(req.PageState[0])
		}
		r := rows(pages[i])
		if i < len(pages)-1 {
			r.HasMore = true
			r.PageState = base64.StdEncoding.EncodeToString([]byte{byte(i + 1)})
		}
		return r, nil
	})
	h.sh.Format = "raw"
	if err := h.sh.Execute(context.Background(), "SELECT * FROM t"); err != nil {
		t.Fatal(err)
	}
	if got, want := h.out.String(), "id\tname\n1\ta\n2\tb\n3\tc\n"; got != want {
		t.Errorf("out = %q, want %q", got, want)
	}
	if len(h.ex.reqs) != 3 {
		t.Errorf("requests = %d", len(h.ex.reqs))
	}
}

func TestPagingPauseStops(t *testing.T) {
	h := newHarness(func(exec.Request) (*exec.Result, error) {
		r := rows([2]any{1, "a"})
		r.HasMore, r.PageState = true, base64.StdEncoding.EncodeToString([]byte{1})
		return r, nil
	})
	asked := 0
	h.sh.Pause = func() bool { asked++; return false }
	_ = h.sh.Execute(context.Background(), "SELECT * FROM t")
	if asked != 1 || len(h.ex.reqs) != 1 {
		t.Errorf("asked=%d requests=%d", asked, len(h.ex.reqs))
	}
	// PAGING OFF never pauses.
	h.sh.Paging = 0
	h.ex.reqs = nil
	n := 0
	h.ex.fn = func(exec.Request) (*exec.Result, error) {
		n++
		r := rows([2]any{n, "x"})
		r.HasMore = n < 3
		r.PageState = base64.StdEncoding.EncodeToString([]byte{1})
		return r, nil
	}
	h.sh.Pause = func() bool { t.Error("paused with paging off"); return false }
	_ = h.sh.Execute(context.Background(), "SELECT * FROM t")
	if len(h.ex.reqs) != 3 {
		t.Errorf("requests = %d", len(h.ex.reqs))
	}
}

func TestFilteringHint(t *testing.T) {
	h := newHarness(func(exec.Request) (*exec.Result, error) {
		return nil, &exec.ErrFilteringRequired{Message: "Cannot execute this query ... use ALLOW FILTERING"}
	})
	_ = h.run("SELECT * FROM t WHERE x = 1;")
	if !strings.Contains(h.err.String(), "ALLOW FILTERING") || !strings.Contains(h.err.String(), "Hint:") {
		t.Errorf("err = %q", h.err)
	}
}

func TestWarningsAndTimingGoToStderr(t *testing.T) {
	h := newHarness(func(exec.Request) (*exec.Result, error) {
		r := rows([2]any{1, "a"})
		r.Warnings = []string{"Aggregation query used without partition key"}
		r.Timing.ClientMS = 4.2
		return r, nil
	})
	h.sh.Timing = true
	_ = h.sh.Execute(context.Background(), "SELECT * FROM t")
	if !strings.Contains(h.err.String(), "Warning: Aggregation query") || !strings.Contains(h.err.String(), "Time: 4.2 ms") {
		t.Errorf("err = %q", h.err)
	}
	if strings.Contains(h.out.String(), "Warning") || strings.Contains(h.out.String(), "Time:") {
		t.Errorf("stderr content leaked to stdout: %q", h.out)
	}
}

func TestVoidStatementPrintsNothing(t *testing.T) {
	h := newHarness(nil)
	if err := h.run("INSERT INTO t (a) VALUES (1);"); err != nil || h.out.Len() != 0 {
		t.Errorf("err=%v out=%q", err, h.out)
	}
}

func traceFixture() *trace.Trace {
	return trace.Shape("5b0f8a40-9c9d-11f1-8b3a-0242ac120002",
		&trace.SessionRow{Coordinator: "10.0.0.1", Request: "Execute CQL3 query", DurationUS: 31700, StartedAt: time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)},
		[]trace.EventRow{
			{Activity: "Parsing SELECT", Source: "10.0.0.1", ElapsedUS: 412},
			{Activity: "READ message received", Source: "10.0.0.2", ElapsedUS: 7004},
		})
}

func TestTracingToggleAndTable(t *testing.T) {
	h := newHarness(func(exec.Request) (*exec.Result, error) {
		r := rows([2]any{1, "a"})
		r.TraceID = traceFixture().ID
		r.Timing.ClientMS = 38.2
		return r, nil
	})
	h.sh.Tracer = func(context.Context, string) (*trace.Trace, error) { return traceFixture(), nil }
	if err := h.run(".tracing ON;\n.timing ON;\nSELECT * FROM t;\n"); err != nil {
		t.Fatal(err)
	}
	if !h.ex.reqs[0].Trace {
		t.Error(".tracing ON did not set Trace on the request")
	}
	out := h.out.String()
	for _, want := range []string{"Tracing session: 5b0f8a40", "Parsing SELECT", "12:00:00.000412", "(2 events)"} {
		if !strings.Contains(out, want) {
			t.Errorf("out missing %q:\n%s", want, out)
		}
	}
	if !strings.Contains(h.err.String(), "Time: 38.2 ms (coordinator 31.7 ms)") {
		t.Errorf("err = %q", h.err)
	}
	if strings.Index(out, "(1 row)") > strings.Index(out, "Tracing session") {
		t.Errorf("trace printed before the rows footer:\n%s", out)
	}
	_ = h.run(".tracing OFF;")
	_ = h.run("SELECT * FROM t;")
	if h.ex.reqs[len(h.ex.reqs)-1].Trace {
		t.Error(".tracing OFF still traces")
	}
}

func TestTraceUnavailableHint(t *testing.T) {
	h := newHarness(func(exec.Request) (*exec.Result, error) {
		r := rows([2]any{1, "a"})
		r.TraceID = "abc"
		return r, nil
	})
	h.sh.Tracing = true
	h.sh.Tracer = func(context.Context, string) (*trace.Trace, error) { return nil, trace.ErrNotAvailable }
	_ = h.sh.Execute(context.Background(), "SELECT * FROM t")
	if !strings.Contains(h.err.String(), ".show session abc") {
		t.Errorf("err = %q", h.err)
	}
}

func TestShowSession(t *testing.T) {
	h := newHarness(nil)
	h.sh.Tracer = func(_ context.Context, id string) (*trace.Trace, error) { return traceFixture(), nil }
	if err := h.sh.Execute(context.Background(), ".show SESSION 5b0f8a40-9c9d-11f1-8b3a-0242ac120002"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(h.out.String(), "Parsing SELECT") {
		t.Errorf("out = %q", h.out)
	}
	if err := h.sh.Execute(context.Background(), ".show SESSION"); err == nil {
		t.Error(".show SESSION without an id should fail")
	}
	h.sh.Tracer = func(context.Context, string) (*trace.Trace, error) { return nil, trace.ErrNotAvailable }
	if err := h.sh.Execute(context.Background(), ".show session abc"); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Errorf("err = %v", err)
	}
}

func TestToggleStateAndBadArg(t *testing.T) {
	h := newHarness(nil)
	_ = h.sh.Execute(context.Background(), ".tracing")
	if !strings.Contains(h.out.String(), "Tracing is off.") {
		t.Errorf("out = %q", h.out)
	}
	if err := h.sh.Execute(context.Background(), ".timing MAYBE"); err == nil {
		t.Error("expected syntax error")
	}
}
