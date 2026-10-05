package seed

import (
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"sort"
	"strings"
	"time"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/schema"
)

// ColumnInfo describes one column of the seed form.
type ColumnInfo struct {
	Name       string         `json:"name"`
	Type       string         `json:"type"`
	Desc       codec.TypeDesc `json:"desc"`
	Kind       string         `json:"kind"`
	Key        bool           `json:"key"`
	Compatible []string       `json:"compatible"`
}

// Columns describes the table's columns for the seed form.
func Columns(t schema.Table) []ColumnInfo {
	out := make([]ColumnInfo, len(t.Columns))
	for i, c := range t.Columns {
		out[i] = ColumnInfo{Name: c.Name, Type: c.Type.String(), Desc: c.Type, Kind: c.Kind,
			Key: c.Kind == schema.KindPartition || c.Kind == schema.KindClustering, Compatible: Compatible(c.Type)}
	}
	return out
}

// Plan is a validated configuration bound to a table. Rows come out of Next in
// a fixed order for a given seed.
type Plan struct {
	Table   schema.Table
	Cfg     Config
	Columns []ColumnInfo
	// Notes are non-fatal remarks, such as columns reset after a schema change.
	Notes []string

	snap   *schema.Snapshot
	gens   []Generator
	rngs   []*rand.Rand
	pkIdx  []int
	stIdx  []int // static columns, drawn once per partition
	ckIdx  []int
	rest   []int // non-partition-key columns, table order
	rpp    int
	nParts int

	part, inPart int
	pkVals       []any
	partKeys     map[string]bool
	rowKeys      map[string]bool
	generated    int
	// Skipped counts rows dropped because their primary key kept colliding.
	Skipped int
}

// Now returns the day-truncated UTC anchor for relative times, so two previews
// within a day agree.
func Now() time.Time { return time.Now().UTC().Truncate(24 * time.Hour) }

var consistencies = map[string]bool{"ONE": true, "TWO": true, "THREE": true, "QUORUM": true, "ALL": true,
	"LOCAL_QUORUM": true, "EACH_QUORUM": true, "LOCAL_ONE": true}

// Normalize fills defaults and reconciles cfg with the table: columns that no
// longer exist are dropped and columns whose type changed reset to defaults.
func Normalize(t schema.Table, cfg Config, now time.Time) (Config, []string) {
	notes := []string{}
	if cfg.TotalRows == 0 {
		cfg.TotalRows = 1000
	}
	if cfg.RowsPerPartition == 0 {
		cfg.RowsPerPartition = 100
	}
	if cfg.Concurrency == 0 {
		cfg.Concurrency = DefaultWorkers
	}
	if cfg.Consistency == "" {
		cfg.Consistency = DefaultCons
	}
	cols := map[string]*Spec{}
	known := map[string]bool{}
	for _, c := range t.Columns {
		known[c.Name] = true
		key := c.Kind == schema.KindPartition || c.Kind == schema.KindClustering
		s := cfg.Columns[c.Name]
		switch {
		case s == nil:
			s = DefaultSpec(c.Name, c.Type, key, now)
		case s.Type != "" && s.Type != c.Type.String():
			notes = append(notes, fmt.Sprintf("Column %s changed type (%s → %s); its generator was reset to the default.", c.Name, s.Type, c.Type))
			s = DefaultSpec(c.Name, c.Type, key, now)
		default:
			s.Type = c.Type.String()
		}
		cols[c.Name] = s
	}
	var gone []string
	for n := range cfg.Columns {
		if !known[n] {
			gone = append(gone, n)
		}
	}
	sort.Strings(gone)
	for _, n := range gone {
		notes = append(notes, fmt.Sprintf("Column %s no longer exists and was dropped from the configuration.", n))
	}
	cfg.Columns = cols
	return cfg, notes
}

// NewPlan validates cfg against the table and builds its generators. A nil
// Plan comes with at least one FieldError.
func NewPlan(t schema.Table, snap *schema.Snapshot, cfg Config, now time.Time) (*Plan, []FieldError) {
	cfg, notes := Normalize(t, cfg, now)
	sink := &errSink{}
	if cfg.TotalRows < 1 || cfg.TotalRows > MaxRows {
		sink.add("total_rows", "total rows must be between 1 and %d", MaxRows)
	}
	if cfg.RowsPerPartition < 1 || cfg.RowsPerPartition > MaxPerPartition {
		sink.add("rows_per_partition", "rows per partition must be between 1 and %d", MaxPerPartition)
	}
	if cfg.Concurrency < 1 || cfg.Concurrency > MaxConcurrency {
		sink.add("concurrency", "concurrency must be between 1 and %d", MaxConcurrency)
	}
	cfg.Consistency = strings.ToUpper(cfg.Consistency)
	if cfg.Consistency == "ANY" {
		sink.add("consistency", "ANY is not allowed for seeding")
	} else if !consistencies[cfg.Consistency] {
		sink.add("consistency", "unknown consistency level %q", cfg.Consistency)
	}
	if cfg.TTL < 0 {
		sink.add("ttl", "TTL must not be negative")
	}
	if t.Counter && cfg.TTL > 0 {
		sink.add("ttl", "counter tables do not support TTL")
	}
	if t.Counter && cfg.IfNotExists {
		sink.add("if_not_exists", "counter tables do not support IF NOT EXISTS")
	}

	p := &Plan{Table: t, Cfg: cfg, Notes: notes, Columns: Columns(t), snap: snap, partKeys: map[string]bool{}, rowKeys: map[string]bool{}}
	var udt codec.UDTFieldTypes
	if snap != nil {
		udt = snap.UDTFields
	}
	b := &builder{now: now, udt: udt, sink: sink}
	hasCK := false
	for i, c := range t.Columns {
		key := c.Kind == schema.KindPartition || c.Kind == schema.KindClustering
		switch c.Kind {
		case schema.KindPartition:
			p.pkIdx = append(p.pkIdx, i)
		case schema.KindClustering:
			p.ckIdx = append(p.ckIdx, i)
			hasCK = true
		}
		if c.Kind == schema.KindStatic {
			p.stIdx = append(p.stIdx, i)
		} else if c.Kind != schema.KindPartition {
			p.rest = append(p.rest, i)
		}
		p.gens = append(p.gens, b.build("columns."+c.Name, cfg.Columns[c.Name], c.Type, key))
		p.rngs = append(p.rngs, rand.New(rand.NewPCG(uint64(cfg.Seed), uint64(i))))
	}
	if len(sink.errs) > 0 {
		return nil, sink.errs
	}
	p.rpp = 1
	if hasCK {
		p.rpp = min(cfg.RowsPerPartition, cfg.TotalRows)
	}
	p.nParts = (cfg.TotalRows + p.rpp - 1) / p.rpp
	return p, nil
}

// Partitions is the number of partitions the run produces.
func (p *Plan) Partitions() int { return p.nParts }

// Done reports whether every row has been produced.
func (p *Plan) Done() bool { return p.generated >= p.Cfg.TotalRows }

func (p *Plan) keyText(row []any, idx []int) string {
	var sb strings.Builder
	for _, i := range idx {
		b, _ := json.Marshal(row[i])
		sb.Write(b)
		sb.WriteByte('|')
	}
	return sb.String()
}

// Next returns the next row in column order (JSON form). ok is false once all
// rows are produced; a row that could not get a unique key is skipped and
// counted in Skipped.
func (p *Plan) Next() (row []any, ok bool) {
	for !p.Done() {
		if p.inPart == 0 {
			if !p.newPartition() {
				// The partition key collided too often; its rows are skipped.
				p.generated += p.partSize()
				p.Skipped += p.partSize()
				p.part++
				continue
			}
		}
		size := p.partSize()
		row = make([]any, len(p.gens))
		for _, i := range p.pkIdx {
			row[i] = p.pkVals[i]
		}
		for _, i := range p.stIdx {
			row[i] = p.pkVals[i]
		}
		unique := false
		for try := 0; try < maxDuplicateTry && !unique; try++ {
			for _, i := range p.rest {
				row[i] = p.gens[i].Next(p.rngs[i])
			}
			k := p.keyText(row, p.pkIdx) + p.keyText(row, p.ckIdx)
			if unique = !p.rowKeys[k]; unique {
				p.rowKeys[k] = true
			}
		}
		p.inPart++
		p.generated++
		if p.inPart >= size {
			p.inPart = 0
			p.part++
		}
		if !unique {
			p.Skipped++
			continue
		}
		return row, true
	}
	return nil, false
}

func (p *Plan) partSize() int {
	if p.part == p.nParts-1 {
		return p.Cfg.TotalRows - p.part*p.rpp
	}
	return p.rpp
}

// newPartition draws partition key values once for the partition about to start.
func (p *Plan) newPartition() bool {
	p.pkVals = make([]any, len(p.gens))
	for try := 0; try < maxDuplicateTry; try++ {
		for _, i := range p.pkIdx {
			p.pkVals[i] = p.gens[i].Next(p.rngs[i])
		}
		if k := p.keyText(p.pkVals, p.pkIdx); !p.partKeys[k] {
			p.partKeys[k] = true
			for _, i := range p.stIdx {
				p.pkVals[i] = p.gens[i].Next(p.rngs[i])
			}
			p.rowKeys = map[string]bool{}
			return true
		}
	}
	return false
}

// Rows returns up to n rows from a fresh walk through the plan.
func (p *Plan) Rows(n int) [][]any {
	out := [][]any{}
	for len(out) < n {
		r, ok := p.Next()
		if !ok {
			break
		}
		out = append(out, r)
	}
	return out
}
