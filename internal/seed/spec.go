// Package seed generates reproducible rows for a table and writes them through
// an Executor. Everything is in-house: the fake-data lists are embedded and the
// regex generator walks Go's regexp/syntax tree (SPEC §9.26).
//
// Generators produce values in the codec JSON form (SPEC §7.3), so a generated
// row can be shown as-is and bound through codec.Decode.
package seed

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Spec configures the generator of one column (or one nested element).
type Spec struct {
	// Type is the CQL type the spec was written for; a mismatch with the
	// current column resets the column to its default.
	Type        string         `json:"type,omitempty"`
	Gen         string         `json:"gen"`
	Params      map[string]any `json:"params,omitempty"`
	NullPercent int            `json:"null_percent,omitempty"`
	// Element is the list/set/map-value generator; Key is the map-key generator.
	Element *Spec `json:"element,omitempty"`
	Key     *Spec `json:"key,omitempty"`
	// Fields holds the per-field generators of a tuple (keys "0", "1", …) or UDT.
	Fields map[string]*Spec `json:"fields,omitempty"`
}

// Config is the whole seed request for one table.
type Config struct {
	Seed             int64            `json:"seed"`
	TotalRows        int              `json:"total_rows"`
	RowsPerPartition int              `json:"rows_per_partition"`
	Concurrency      int              `json:"concurrency"`
	Consistency      string           `json:"consistency"`
	TTL              int              `json:"ttl"`
	IfNotExists      bool             `json:"if_not_exists"`
	Columns          map[string]*Spec `json:"columns"`
}

// FieldError is a problem with one configuration field.
type FieldError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// Limits.
const (
	MaxRows          = 1_000_000
	MaxPerPartition  = 10_000
	MaxConcurrency   = 64
	MaxCollection    = 50
	DefaultCons      = "LOCAL_QUORUM"
	DefaultWorkers   = 8
	maxRegexOutput   = 1024
	maxRegexRepeat   = 8
	maxDuplicateTry  = 10
	maxErrorsAborted = 1000
)

type errSink struct{ errs []FieldError }

func (s *errSink) add(field, format string, a ...any) {
	s.errs = append(s.errs, FieldError{Field: field, Message: fmt.Sprintf(format, a...)})
}

// params reads typed values out of a Spec's loosely typed parameter map.
type params struct {
	m    map[string]any
	path string
	sink *errSink
}

func (p params) has(key string) bool { _, ok := p.m[key]; return ok && p.m[key] != nil }

func (p params) fieldOf(key string) string { return p.path + ".params." + key }

func toFloat(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	case int32:
		return float64(x), true
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		return f, err == nil
	}
	return 0, false
}

func (p params) num(key string, def float64) float64 {
	if !p.has(key) {
		return def
	}
	f, ok := toFloat(p.m[key])
	if !ok || math.IsNaN(f) || math.IsInf(f, 0) {
		p.sink.add(p.fieldOf(key), "%s must be a number", key)
		return def
	}
	return f
}

func (p params) int(key string, def int64) int64 {
	if !p.has(key) {
		return def
	}
	if s, ok := p.m[key].(string); ok {
		if n, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64); err == nil {
			return n
		}
	}
	f, ok := toFloat(p.m[key])
	if !ok || f != math.Trunc(f) {
		p.sink.add(p.fieldOf(key), "%s must be a whole number", key)
		return def
	}
	return int64(f)
}

func (p params) str(key, def string) string {
	if !p.has(key) {
		return def
	}
	s, ok := p.m[key].(string)
	if !ok {
		p.sink.add(p.fieldOf(key), "%s must be text", key)
		return def
	}
	return s
}

func (p params) list(key string) []any {
	if !p.has(key) {
		return nil
	}
	l, ok := p.m[key].([]any)
	if !ok {
		p.sink.add(p.fieldOf(key), "%s must be a list", key)
	}
	return l
}
