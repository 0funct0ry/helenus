package seed

import (
	"context"
	"encoding/json"
	"flag"
	"math/rand/v2"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/jobs"
	"github.com/0funct0ry/helenus/internal/schema"
)

var update = flag.Bool("update", false, "rewrite golden files")

var fixedNow = time.Date(2025, 1, 15, 0, 0, 0, 0, time.UTC)

func col(name, typ, kind string, pos int) schema.Column {
	td, err := codec.Parse(typ, "shop")
	if err != nil {
		panic(err)
	}
	return schema.Column{Name: name, Type: td, CQL: typ, Kind: kind, Position: pos}
}

func usersTable() schema.Table {
	return schema.Table{Keyspace: "shop", Name: "users", Columns: []schema.Column{
		col("id", "uuid", schema.KindPartition, 0),
		col("email", "text", schema.KindRegular, -1),
		col("first_name", "text", schema.KindRegular, -1),
		col("created", "timestamp", schema.KindRegular, -1),
	}}
}

func eventsTable() schema.Table {
	return schema.Table{Keyspace: "shop", Name: "events", Columns: []schema.Column{
		col("sensor", "int", schema.KindPartition, 0),
		col("ts", "timeuuid", schema.KindClustering, 0),
		col("v", "double", schema.KindRegular, -1),
		col("tags", "set<text>", schema.KindRegular, -1),
		col("props", "map<text,int>", schema.KindRegular, -1),
	}}
}

func counterTable() schema.Table {
	return schema.Table{Keyspace: "shop", Name: "hits", Counter: true, Columns: []schema.Column{
		col("page", "text", schema.KindPartition, 0),
		col("day", "date", schema.KindClustering, 0),
		col("n", "counter", schema.KindRegular, -1),
	}}
}

func mustPlan(t *testing.T, tb schema.Table, cfg Config) *Plan {
	t.Helper()
	p, errs := NewPlan(tb, nil, cfg, fixedNow)
	if p == nil {
		t.Fatalf("plan errors: %+v", errs)
	}
	return p
}

func TestDefaultInference(t *testing.T) {
	p := mustPlan(t, usersTable(), Config{Seed: 1})
	want := map[string]struct{ gen, cat string }{
		"id": {GenUUID, ""}, "email": {GenFake, "email"}, "first_name": {GenFake, "first_name"}, "created": {GenTimeRange, ""},
	}
	for name, w := range want {
		s := p.Cfg.Columns[name]
		if s.Gen != w.gen || (w.cat != "" && s.Params["category"] != w.cat) {
			t.Errorf("%s: got %s %v", name, s.Gen, s.Params)
		}
	}
	cases := []struct {
		typ, name string
		key       bool
		gen       string
	}{
		{"int", "k", true, GenSequence}, {"int", "x", false, GenIntRange}, {"boolean", "b", false, GenBoolean},
		{"decimal", "d", false, GenDecimal}, {"blob", "b", false, GenBlob}, {"inet", "i", false, GenInet},
		{"list<int>", "l", false, GenCollection}, {"timeuuid", "t", false, GenTimeUUID}, {"text", "other", false, GenFake},
		{"counter", "c", false, GenIntRange}, {"vector<float, 3>", "v", false, GenVector},
	}
	for _, c := range cases {
		td, _ := codec.Parse(c.typ, "ks")
		if g := DefaultSpec(c.name, td, c.key, fixedNow).Gen; g != c.gen {
			t.Errorf("%s key=%v: %s, want %s", c.typ, c.key, g, c.gen)
		}
	}
}

func TestSeedGolden(t *testing.T) {
	out := map[string][][]any{}
	for name, tb := range map[string]schema.Table{"users": usersTable(), "events": eventsTable(), "hits": counterTable()} {
		out[name] = mustPlan(t, tb, Config{Seed: 42, TotalRows: 20, RowsPerPartition: 4}).Rows(5)
	}
	got, _ := json.MarshalIndent(out, "", "  ")
	path := "testdata/seed42.golden.json"
	if *update {
		_ = os.MkdirAll("testdata", 0o755)
		if err := os.WriteFile(path, append(got, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(want)) != string(got) {
		t.Errorf("golden mismatch; run make golden-seed\n got: %s", got)
	}
}

func TestDeterministicAndSeedSensitive(t *testing.T) {
	a := mustPlan(t, usersTable(), Config{Seed: 7, TotalRows: 30}).Rows(30)
	b := mustPlan(t, usersTable(), Config{Seed: 7, TotalRows: 30}).Rows(30)
	c := mustPlan(t, usersTable(), Config{Seed: 8, TotalRows: 30}).Rows(30)
	ja, jb, jc := rowsJSON(a), rowsJSON(b), rowsJSON(c)
	if ja != jb {
		t.Error("same seed produced different rows")
	}
	if ja == jc {
		t.Error("different seeds produced identical rows")
	}
}

func TestFakeEmailDomains(t *testing.T) {
	p := mustPlan(t, usersTable(), Config{Seed: 3, TotalRows: 500})
	re := regexp.MustCompile(`^[a-z]+\.[a-z]+\d+@example\.(com|org|net)$`)
	for _, r := range p.Rows(500) {
		if e := r[1].(string); !re.MatchString(e) {
			t.Fatalf("bad email %q", e)
		}
	}
}

func TestPartitionShape(t *testing.T) {
	p := mustPlan(t, eventsTable(), Config{Seed: 1, TotalRows: 1000, RowsPerPartition: 100})
	if p.Partitions() != 10 {
		t.Fatalf("partitions = %d", p.Partitions())
	}
	per := map[any]int{}
	n := 0
	for {
		r, ok := p.Next()
		if !ok {
			break
		}
		per[r[0]]++
		n++
	}
	if n != 1000 || len(per) != 10 {
		t.Fatalf("rows=%d partitions=%d", n, len(per))
	}
	for k, c := range per {
		if c != 100 {
			t.Errorf("partition %v has %d rows", k, c)
		}
	}
}

func TestRowsPerPartitionClampedWithoutClustering(t *testing.T) {
	p := mustPlan(t, usersTable(), Config{Seed: 1, TotalRows: 50, RowsPerPartition: 10})
	if p.Partitions() != 50 {
		t.Fatalf("partitions = %d", p.Partitions())
	}
}

func TestPartitionKeyCollisionSkips(t *testing.T) {
	tb := schema.Table{Keyspace: "shop", Name: "t", Columns: []schema.Column{col("k", "boolean", schema.KindPartition, 0)}}
	p := mustPlan(t, tb, Config{Seed: 1, TotalRows: 10})
	n := len(p.Rows(10))
	if n > 2 || p.Skipped < 8 {
		t.Fatalf("rows=%d skipped=%d", n, p.Skipped)
	}
}

func buildOne(t *testing.T, typ string, spec *Spec) (Generator, []FieldError) {
	t.Helper()
	td, err := codec.Parse(typ, "ks")
	if err != nil {
		t.Fatal(err)
	}
	sink := &errSink{}
	b := &builder{now: fixedNow, sink: sink}
	g := b.build("columns.x", spec, td, false)
	return g, sink.errs
}

func TestGeneratorBoundsAndCompat(t *testing.T) {
	rng := rand.New(rand.NewPCG(1, 2))
	g, errs := buildOne(t, "int", &Spec{Gen: GenIntRange, Params: map[string]any{"min": 5, "max": 7}})
	if errs != nil {
		t.Fatal(errs)
	}
	for i := 0; i < 200; i++ {
		if v := g.Next(rng).(int64); v < 5 || v > 7 {
			t.Fatalf("out of range: %d", v)
		}
	}
	g, _ = buildOne(t, "double", &Spec{Gen: GenFloatRange, Params: map[string]any{"min": 1, "max": 2, "decimals": 1}})
	for i := 0; i < 100; i++ {
		if v := g.Next(rng).(float64); v < 1 || v > 2 {
			t.Fatalf("float out of range: %v", v)
		}
	}
	g, _ = buildOne(t, "boolean", &Spec{Gen: GenBoolean, Params: map[string]any{"p_true": 1}})
	if g.Next(rng) != true {
		t.Error("p_true=1 gave false")
	}
	bad := []struct {
		typ  string
		spec *Spec
	}{
		{"int", &Spec{Gen: GenUUID}},
		{"text", &Spec{Gen: GenIntRange}},
		{"tinyint", &Spec{Gen: GenIntRange, Params: map[string]any{"min": 0, "max": 300}}},
		{"int", &Spec{Gen: GenIntRange, Params: map[string]any{"min": 9, "max": 1}}},
		{"text", &Spec{Gen: GenFake, Params: map[string]any{"category": "nope"}}},
		{"text", &Spec{Gen: GenChoice}},
		{"int", &Spec{Gen: GenConstant, Params: map[string]any{"value": "abc"}}},
		{"list<int>", &Spec{Gen: GenCollection, Params: map[string]any{"min": 0, "max": 99}}},
		{"int", &Spec{Gen: GenIntRange, NullPercent: 101}},
	}
	for i, c := range bad {
		if g, errs := buildOne(t, c.typ, c.spec); g != nil || len(errs) == 0 {
			t.Errorf("case %d: expected a field error", i)
		}
	}
}

func TestChoiceWeightsAndNulls(t *testing.T) {
	rng := rand.New(rand.NewPCG(1, 2))
	g, errs := buildOne(t, "text", &Spec{Gen: GenChoice, Params: map[string]any{
		"values": []any{"a", "b"}, "weights": []any{0, 1}}})
	if errs != nil {
		t.Fatal(errs)
	}
	for i := 0; i < 50; i++ {
		if g.Next(rng) != "b" {
			t.Fatal("zero-weight value chosen")
		}
	}
	g, _ = buildOne(t, "int", &Spec{Gen: GenIntRange, NullPercent: 100})
	if g.Next(rng) != nil {
		t.Error("100% null produced a value")
	}
}

func TestCollectionsTuplesVectors(t *testing.T) {
	rng := rand.New(rand.NewPCG(1, 2))
	g, errs := buildOne(t, "set<int>", &Spec{Gen: GenCollection, Params: map[string]any{"min": 5, "max": 5},
		Element: &Spec{Gen: GenIntRange, Params: map[string]any{"min": 0, "max": 100}}})
	if errs != nil {
		t.Fatal(errs)
	}
	seen := map[any]bool{}
	for _, v := range g.Next(rng).([]any) {
		if seen[v] {
			t.Fatal("set has duplicates")
		}
		seen[v] = true
	}
	g, _ = buildOne(t, "map<text,int>", &Spec{Gen: GenCollection, Params: map[string]any{"min": 2, "max": 2},
		Key: &Spec{Gen: GenFake, Params: map[string]any{"category": "word"}}, Element: &Spec{Gen: GenIntRange}})
	if m := g.Next(rng).([]any); len(m) < 1 || len(m[0].([]any)) != 2 {
		t.Errorf("bad map %v", m)
	}
	g, _ = buildOne(t, "tuple<int,text>", &Spec{Gen: GenComposite})
	if tp := g.Next(rng).([]any); len(tp) != 2 {
		t.Errorf("bad tuple %v", tp)
	}
	g, _ = buildOne(t, "vector<float, 4>", &Spec{Gen: GenVector})
	if v := g.Next(rng).([]any); len(v) != 4 {
		t.Errorf("bad vector %v", v)
	}
}

func TestRegex(t *testing.T) {
	rng := rand.New(rand.NewPCG(1, 2))
	g, errs := buildOne(t, "text", &Spec{Gen: GenRegex, Params: map[string]any{"pattern": `[A-Z]{3}-\d{4}`}})
	if errs != nil {
		t.Fatal(errs)
	}
	re := regexp.MustCompile(`^[A-Z]{3}-\d{4}$`)
	for i := 0; i < 100; i++ {
		if v := g.Next(rng).(string); !re.MatchString(v) {
			t.Fatalf("value %q does not match", v)
		}
	}
	_, errs = buildOne(t, "text", &Spec{Gen: GenRegex, Params: map[string]any{"pattern": `(`}})
	if len(errs) != 1 || errs[0].Field != "columns.x.params.pattern" || !strings.Contains(errs[0].Message, "missing closing )") {
		t.Fatalf("errs = %+v", errs)
	}
	// Caps: unbounded repeats stop at 8; output stops at 1024 characters.
	g, _ = buildOne(t, "text", &Spec{Gen: GenRegex, Params: map[string]any{"pattern": `a*`}})
	for i := 0; i < 200; i++ {
		if len(g.Next(rng).(string)) > 8 {
			t.Fatal("a* exceeded 8 repeats")
		}
	}
	g, _ = buildOne(t, "text", &Spec{Gen: GenRegex, Params: map[string]any{"pattern": `a{1000}b{1000}`}})
	if n := len(g.Next(rng).(string)); n != maxRegexOutput {
		t.Fatalf("len = %d", n)
	}
	g, _ = buildOne(t, "text", &Spec{Gen: GenRegex, Params: map[string]any{"pattern": `^(foo|bar).$`}})
	if v := g.Next(rng).(string); len(v) != 4 {
		t.Fatalf("anchors/alternation: %q", v)
	}
}

func TestTimeGenerators(t *testing.T) {
	rng := rand.New(rand.NewPCG(1, 2))
	g, _ := buildOne(t, "timeuuid", &Spec{Gen: GenTimeUUID})
	u := g.Next(rng).(string)
	if len(u) != 36 || u[14] != '1' {
		t.Fatalf("timeuuid %q", u)
	}
	g, _ = buildOne(t, "timestamp", &Spec{Gen: GenTimeRange, Params: map[string]any{"from": "2025-01-01", "to": "2025-01-02"}})
	ts, err := time.Parse("2006-01-02T15:04:05.000Z", g.Next(rng).(string))
	if err != nil || ts.Before(time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)) || ts.After(time.Date(2025, 1, 2, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("timestamp %v %v", ts, err)
	}
	if _, errs := buildOne(t, "timestamp", &Spec{Gen: GenTimeRange, Params: map[string]any{"from": "garbage"}}); len(errs) == 0 {
		t.Error("garbage time accepted")
	}
	if durationText(90061) != "1d1h1m1s" || durationText(0) != "0s" {
		t.Error("durationText")
	}
}

func TestEveryGeneratorDecodes(t *testing.T) {
	// Whatever the defaults emit must bind through the codec.
	types := []string{"ascii", "bigint", "blob", "boolean", "date", "decimal", "double", "duration", "float", "inet", "int",
		"smallint", "text", "time", "timestamp", "timeuuid", "tinyint", "uuid", "varint", "list<text>", "set<int>",
		"map<text,int>", "tuple<int,text>", "vector<float, 3>"}
	for _, typ := range types {
		td, _ := codec.Parse(typ, "ks")
		sink := &errSink{}
		b := &builder{now: fixedNow, sink: sink}
		g := b.build("x", DefaultSpec("x", td, false, fixedNow), td, false)
		if g == nil {
			t.Errorf("%s: %+v", typ, sink.errs)
			continue
		}
		rng := rand.New(rand.NewPCG(5, 6))
		for i := 0; i < 20; i++ {
			raw, _ := json.Marshal(g.Next(rng))
			if _, err := codec.Decode(raw, td, nil); err != nil {
				t.Errorf("%s: %s: %v", typ, raw, err)
				break
			}
		}
	}
}

func TestValidation(t *testing.T) {
	_, errs := NewPlan(usersTable(), nil, Config{TotalRows: MaxRows + 1, Concurrency: 99, Consistency: "ANY", TTL: -1}, fixedNow)
	fields := map[string]bool{}
	for _, e := range errs {
		fields[e.Field] = true
	}
	for _, f := range []string{"total_rows", "concurrency", "consistency", "ttl"} {
		if !fields[f] {
			t.Errorf("missing error for %s: %+v", f, errs)
		}
	}
	_, errs = NewPlan(counterTable(), nil, Config{IfNotExists: true, TTL: 5}, fixedNow)
	if len(errs) != 2 {
		t.Errorf("counter errors = %+v", errs)
	}
	cfg := Config{Columns: map[string]*Spec{"email": {Gen: GenNull}, "id": {Gen: GenNull}}}
	if _, errs := NewPlan(usersTable(), nil, cfg, fixedNow); len(errs) != 1 || errs[0].Field != "columns.id" {
		t.Errorf("key null errors = %+v", errs)
	}
}

func TestNormalizeSchemaChange(t *testing.T) {
	cfg := Config{Columns: map[string]*Spec{
		"email": {Type: "int", Gen: GenIntRange}, // type changed
		"gone":  {Gen: GenNull},
	}}
	got, notes := Normalize(usersTable(), cfg, fixedNow)
	if got.Columns["email"].Gen != GenFake || got.Columns["gone"] != nil || len(notes) != 2 {
		t.Errorf("cfg=%+v notes=%v", got.Columns["email"], notes)
	}
}

func TestStatements(t *testing.T) {
	p := mustPlan(t, usersTable(), Config{Seed: 1, TTL: 60, IfNotExists: true})
	s, idx := p.Statement()
	if s != "INSERT INTO shop.users (id, email, first_name, created) VALUES (?, ?, ?, ?) IF NOT EXISTS USING TTL 60" || len(idx) != 4 {
		t.Errorf("stmt %q", s)
	}
	c := mustPlan(t, counterTable(), Config{Seed: 1})
	s, idx = c.Statement()
	if s != "UPDATE shop.hits SET n = n + ? WHERE page = ? AND day = ?" || len(idx) != 3 || idx[0] != 2 {
		t.Errorf("counter stmt %q %v", s, idx)
	}
	row, _ := c.Next()
	if sample := c.Sample(row); !strings.HasPrefix(sample, "UPDATE shop.hits SET n = n + ") {
		t.Errorf("sample %q", sample)
	}
}

type recorder struct {
	mu    sync.Mutex
	stmts []string
	args  [][]any
	fail  func(n int) error
	delay time.Duration
}

func (r *recorder) Exec(ctx context.Context, cql string, args []any, cons string) error {
	r.mu.Lock()
	r.stmts = append(r.stmts, cons)
	r.args = append(r.args, args)
	n := len(r.stmts)
	r.mu.Unlock()
	if r.delay > 0 {
		select {
		case <-time.After(r.delay):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	if r.fail != nil {
		return r.fail(n)
	}
	return nil
}

func runPlan(t *testing.T, p *Plan, ex Executor) (jobs.Job, *jobs.Registry) {
	t.Helper()
	reg := jobs.New()
	j := reg.Start("seed", "p", func(ctx context.Context, rep *jobs.Reporter) error { return p.Run(ctx, ex, rep) })
	return j, reg
}

func waitDone(t *testing.T, reg *jobs.Registry, id string) jobs.Job {
	t.Helper()
	for i := 0; i < 500; i++ {
		if j, _ := reg.Get("p", id); j.State != jobs.Running {
			return j
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("job did not finish")
	return jobs.Job{}
}

func TestRunWritesEveryRow(t *testing.T) {
	p := mustPlan(t, eventsTable(), Config{Seed: 1, TotalRows: 500, RowsPerPartition: 50, Concurrency: 4, Consistency: "quorum"})
	rec := &recorder{}
	j, reg := runPlan(t, p, rec)
	got := waitDone(t, reg, j.ID)
	res := got.Result.(Result)
	if got.State != jobs.Done || res.Written != 500 || res.Partitions != 10 || len(rec.stmts) != 500 || rec.stmts[0] != "QUORUM" {
		t.Fatalf("state=%s result=%+v calls=%d", got.State, res, len(rec.stmts))
	}
}

func TestRunErrorsAbort(t *testing.T) {
	p := mustPlan(t, usersTable(), Config{Seed: 1, TotalRows: 5000, Concurrency: 2})
	rec := &recorder{fail: func(int) error { return context.DeadlineExceeded }}
	j, reg := runPlan(t, p, rec)
	got := waitDone(t, reg, j.ID)
	res := got.Result.(Result)
	if got.State != jobs.Failed || res.Errors < maxErrorsAborted || len(res.FirstErrs) != 100 {
		t.Fatalf("state=%s result=%+v", got.State, res)
	}
}

func TestRunCancel(t *testing.T) {
	p := mustPlan(t, usersTable(), Config{Seed: 1, TotalRows: 100000, Concurrency: 4})
	rec := &recorder{delay: 5 * time.Millisecond}
	j, reg := runPlan(t, p, rec)
	time.Sleep(100 * time.Millisecond)
	start := time.Now()
	reg.Cancel("p", j.ID)
	got := waitDone(t, reg, j.ID)
	res := got.Result.(Result)
	if got.State != jobs.Cancelled || time.Since(start) > time.Second || res.Written == 0 || res.Written >= 100000 {
		t.Fatalf("state=%s took=%v result=%+v", got.State, time.Since(start), res)
	}
}

func rowsJSON(rows [][]any) string { b, _ := json.Marshal(rows); return string(b) }
