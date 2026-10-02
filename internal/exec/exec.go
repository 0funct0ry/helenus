// Package exec runs CQL against a session and returns typed results for the
// shell and the web API (SPEC §7, §9.6, §9.7). It knows nothing of HTTP or terminals.
package exec

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"

	gocql "github.com/apache/cassandra-gocql-driver/v2"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/cql"
	"github.com/0funct0ry/helenus/internal/schema"
)

// Result kinds.
const (
	KindRows         = "rows"
	KindVoid         = "void"
	KindSchemaChange = "schema_change"
)

// Request is one statement execution.
type Request struct {
	CQL               string
	Keyspace          string
	Consistency       string
	SerialConsistency string
	PageSize          int
	PageState         []byte
	AllowFiltering    bool
	Trace             bool
	// Timeout bounds the request; zero leaves the session default.
	Timeout time.Duration
}

// Column describes one result column.
type Column struct {
	Name     string         `json:"name"`
	Type     codec.TypeDesc `json:"type"`
	Kind     string         `json:"kind,omitempty"`
	Position int            `json:"position,omitempty"`
	Order    string         `json:"order,omitempty"`
}

// Timing reports client-side latency.
type Timing struct {
	ClientMS float64 `json:"client_ms"`
}

// Result is the outcome of one statement.
type Result struct {
	Kind          string   `json:"kind"`
	ExecutedCQL   string   `json:"executed_cql"`
	Columns       []Column `json:"columns"`
	Rows          [][]any  `json:"rows"`
	PageState     string   `json:"page_state,omitempty"`
	HasMore       bool     `json:"has_more"`
	Warnings      []string `json:"warnings"`
	TraceID       string   `json:"trace_id,omitempty"`
	Timing        Timing   `json:"timing"`
	KeyspaceAfter string   `json:"keyspace_after,omitempty"`
	// Raw holds the unencoded values for the shell's text renderer; not serialized.
	Raw [][]any `json:"-"`
}

// ErrFilteringRequired is returned when the server rejects a query that needs
// ALLOW FILTERING (SPEC §9.7).
type ErrFilteringRequired struct{ Message string }

func (e *ErrFilteringRequired) Error() string { return e.Message }

// Executor runs statements. Snapshot may be nil, in which case column kinds are omitted.
type Executor struct {
	Session *gocql.Session
	// Snapshot supplies column kinds and UDT field types; may return nil.
	Snapshot func(ctx context.Context) *schema.Snapshot
	// Refresh re-reads the schema after a schema change.
	Refresh func(ctx context.Context)
}

// Run executes req and reads exactly one page of rows.
func (x *Executor) Run(ctx context.Context, req Request) (*Result, error) {
	stmt := strings.TrimSpace(req.CQL)
	if stmt == "" {
		return nil, errors.New("empty statement")
	}
	if ks, ok := parseUse(stmt); ok {
		return x.use(ctx, stmt, ks)
	}
	if req.AllowFiltering {
		stmt = cql.AppendAllowFiltering(stmt)
	}
	if req.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, req.Timeout)
		defer cancel()
	}
	q := x.Session.Query(stmt)
	if req.Keyspace != "" {
		q = q.SetKeyspace(req.Keyspace)
	}
	if req.Consistency != "" {
		c, err := gocql.ParseConsistencyWrapper(req.Consistency)
		if err != nil {
			return nil, fmt.Errorf("invalid consistency %q", req.Consistency)
		}
		q = q.Consistency(c)
	}
	if req.SerialConsistency != "" {
		c, err := gocql.ParseConsistencyWrapper(req.SerialConsistency)
		if err != nil {
			return nil, fmt.Errorf("invalid serial consistency %q", req.SerialConsistency)
		}
		q = q.SerialConsistency(c)
	}
	if req.PageSize > 0 {
		q = q.PageSize(req.PageSize)
	}
	// Always set the page state: it also turns off the driver's read-ahead, so
	// only the page we return is fetched.
	q = q.PageState(req.PageState)
	var tr traceCapture
	if req.Trace {
		q = q.Trace(&tr)
	}

	start := time.Now()
	it := q.IterContext(ctx)
	res := &Result{ExecutedCQL: stmt, Warnings: []string{}, Rows: [][]any{}}
	cols := it.Columns()
	var snap *schema.Snapshot
	if x.Snapshot != nil && len(cols) > 0 {
		snap = x.Snapshot(ctx)
	}
	enc := codec.Encoder{BlobLimit: codec.DefaultBlobLimit, UDTFields: udtFields(snap)}
	res.Columns = describe(cols, snap)
	if len(cols) > 0 {
		res.Kind = KindRows
		n := it.NumRows()
		for i := 0; i < n; i++ {
			dest, finish := scanDest(cols)
			if !it.Scan(dest...) {
				break
			}
			raw := finish()
			row := make([]any, len(raw))
			for j, v := range raw {
				row[j] = enc.JSON(v, res.Columns[j].Type)
			}
			res.Rows = append(res.Rows, row)
			res.Raw = append(res.Raw, raw)
		}
		if ps := it.PageState(); len(ps) > 0 {
			res.PageState = base64.StdEncoding.EncodeToString(ps)
			res.HasMore = true
		}
	} else if isSchemaChange(stmt) {
		res.Kind = KindSchemaChange
	} else {
		res.Kind = KindVoid
	}
	res.Warnings = append(res.Warnings, it.Warnings()...)
	if err := it.Close(); err != nil {
		return nil, classify(err)
	}
	res.Timing.ClientMS = float64(time.Since(start).Microseconds()) / 1000
	if id := tr.id(); id != "" {
		res.TraceID = id
	}
	if res.Kind == KindSchemaChange && x.Refresh != nil {
		x.Refresh(ctx)
	}
	return res, nil
}

func (x *Executor) use(ctx context.Context, stmt, ks string) (*Result, error) {
	var name string
	err := x.Session.Query("SELECT keyspace_name FROM system_schema.keyspaces WHERE keyspace_name = ?", ks).
		ScanContext(ctx, &name)
	if errors.Is(err, gocql.ErrNotFound) {
		return nil, fmt.Errorf("Keyspace '%s' does not exist", ks)
	}
	if err != nil {
		return nil, classify(err)
	}
	return &Result{Kind: KindVoid, ExecutedCQL: stmt, Columns: []Column{}, Rows: [][]any{}, Warnings: []string{}, KeyspaceAfter: ks}, nil
}

// parseUse recognizes USE <keyspace>, returning the unquoted keyspace name.
func parseUse(stmt string) (string, bool) {
	s := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(stmt), ";"))
	if len(s) < 5 || !strings.EqualFold(s[:3], "USE") || (s[3] != ' ' && s[3] != '\t' && s[3] != '\n') {
		return "", false
	}
	ks := strings.TrimSpace(s[4:])
	if strings.HasPrefix(ks, `"`) && strings.HasSuffix(ks, `"`) && len(ks) >= 2 {
		return strings.ReplaceAll(ks[1:len(ks)-1], `""`, `"`), true
	}
	if strings.ContainsAny(ks, " \t\n;") {
		return "", false
	}
	return strings.ToLower(ks), true
}

func isSchemaChange(stmt string) bool {
	f := strings.ToUpper(strings.Fields(stmt)[0])
	return f == "CREATE" || f == "ALTER" || f == "DROP"
}

func classify(err error) error {
	var inv *gocql.RequestErrInvalid
	if errors.As(err, &inv) && strings.Contains(strings.ToUpper(inv.Message()), "ALLOW FILTERING") {
		return &ErrFilteringRequired{Message: inv.Message()}
	}
	return err
}

// scanDest builds scan destinations that distinguish NULL (nil pointers) and
// expand tuple columns, which the driver scans element by element.
func scanDest(cols []gocql.ColumnInfo) ([]any, func() []any) {
	var dest []any
	type slot struct{ n int }
	slots := make([]slot, len(cols))
	for i, c := range cols {
		if t, ok := c.TypeInfo.(gocql.TupleTypeInfo); ok {
			slots[i].n = len(t.Elems)
			for _, e := range t.Elems {
				dest = append(dest, reflect.New(reflect.PointerTo(reflect.TypeOf(e.Zero()))).Interface())
			}
			continue
		}
		slots[i].n = -1
		dest = append(dest, reflect.New(reflect.PointerTo(reflect.TypeOf(c.TypeInfo.Zero()))).Interface())
	}
	return dest, func() []any {
		out := make([]any, len(cols))
		k := 0
		for i, s := range slots {
			if s.n < 0 {
				out[i] = derefNull(dest[k])
				k++
				continue
			}
			tuple := make([]any, s.n)
			for j := range tuple {
				tuple[j] = derefNull(dest[k])
				k++
			}
			out[i] = tuple
		}
		return out
	}
}

// derefNull turns a **T into nil (NULL) or the T value.
func derefNull(p any) any {
	rv := reflect.ValueOf(p).Elem()
	if rv.IsNil() {
		return nil
	}
	return rv.Elem().Interface()
}

func describe(cols []gocql.ColumnInfo, snap *schema.Snapshot) []Column {
	out := make([]Column, len(cols))
	for i, c := range cols {
		out[i] = Column{Name: c.Name, Type: codec.FromDriver(c.TypeInfo)}
		if snap == nil {
			continue
		}
		if sc := lookup(snap, c.Keyspace, c.Table, c.Name); sc != nil {
			out[i].Type, out[i].Kind, out[i].Position, out[i].Order = sc.Type, sc.Kind, sc.Position, sc.Order
		}
	}
	return out
}

func lookup(snap *schema.Snapshot, ks, table, col string) *schema.Column {
	k := snap.Keyspace(ks)
	if k == nil {
		return nil
	}
	var cs []schema.Column
	if t := k.Table(table); t != nil {
		cs = t.Columns
	} else if v := k.View(table); v != nil {
		cs = v.Columns
	}
	for i := range cs {
		if cs[i].Name == col {
			return &cs[i]
		}
	}
	return nil
}

func udtFields(snap *schema.Snapshot) func(codec.UDTRef) map[string]codec.TypeDesc {
	if snap == nil {
		return nil
	}
	return func(r codec.UDTRef) map[string]codec.TypeDesc {
		k := snap.Keyspace(r.Keyspace)
		if k == nil {
			return nil
		}
		u := k.Type(r.Name)
		if u == nil {
			return nil
		}
		m := make(map[string]codec.TypeDesc, len(u.Fields))
		for _, f := range u.Fields {
			m[f.Name] = f.Type
		}
		return m
	}
}

type traceCapture struct{ b []byte }

func (t *traceCapture) Trace(id []byte) { t.b = append([]byte(nil), id...) }

func (t *traceCapture) id() string {
	if len(t.b) != 16 {
		return ""
	}
	u, err := gocql.UUIDFromBytes(t.b)
	if err != nil {
		return ""
	}
	return u.String()
}

// ForSession wires an Executor to a session and the profile's schema cache.
func ForSession(sess *gocql.Session, cache *schema.Cache, profile string) *Executor {
	return &Executor{
		Session: sess,
		Snapshot: func(ctx context.Context) *schema.Snapshot {
			snap, err := cache.Get(ctx, profile, sess)
			if err != nil {
				return nil
			}
			return snap
		},
		Refresh: func(ctx context.Context) { _, _ = cache.Refresh(ctx, profile, sess) },
	}
}
