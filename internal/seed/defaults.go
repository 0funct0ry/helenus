package seed

import (
	"strings"
	"time"

	"github.com/0funct0ry/helenus/internal/codec"
)

var nameCategories = map[string]string{
	"email": "email", "first_name": "first_name", "last_name": "last_name", "name": "full_name",
	"phone": "phone", "city": "city", "country": "country", "company": "company", "url": "url", "zip": "zip",
}

// DefaultSpec infers a sensible generator from a column's type and name. key
// is set for primary-key columns.
func DefaultSpec(name string, td codec.TypeDesc, key bool, now time.Time) *Spec {
	s := &Spec{Type: td.String()}
	switch n := td.Name; {
	case n == "uuid":
		s.Gen = GenUUID
	case n == "timeuuid":
		s.Gen = GenTimeUUID
		s.Params = map[string]any{"from": "now-30d", "to": "now"}
	case n == "counter":
		s.Gen, s.Params = GenIntRange, map[string]any{"min": 1, "max": 10}
	case isInt(n) && key:
		s.Gen, s.Params = GenSequence, map[string]any{"start": 1, "step": 1}
	case isInt(n):
		s.Gen, s.Params = GenIntRange, map[string]any{"min": 0, "max": 1000}
		if lo, hi := typeBounds(n); hi < 1000 {
			s.Params = map[string]any{"min": max(0, lo), "max": hi}
		}
	case isText(n):
		cat := nameCategories[strings.ToLower(name)]
		if cat == "" {
			cat = "word"
		}
		s.Gen, s.Params = GenFake, map[string]any{"category": cat}
	case n == "boolean":
		s.Gen, s.Params = GenBoolean, map[string]any{"p_true": 0.5}
	case n == "timestamp" || n == "date":
		s.Gen, s.Params = GenTimeRange, map[string]any{"from": "now-30d", "to": "now"}
	case n == "time":
		s.Gen, s.Params = GenTimeRange, map[string]any{"from": "00:00:00", "to": "23:59:59"}
	case n == "decimal":
		s.Gen, s.Params = GenDecimal, map[string]any{"min": 0, "max": 1000, "decimals": 2}
	case n == "float" || n == "double":
		s.Gen, s.Params = GenFloatRange, map[string]any{"min": 0, "max": 1000, "decimals": 2}
	case n == "duration":
		s.Gen, s.Params = GenDuration, map[string]any{"min_seconds": 60, "max_seconds": 86400}
	case n == "blob":
		s.Gen, s.Params = GenBlob, map[string]any{"min_len": 8, "max_len": 32}
	case n == "inet":
		s.Gen, s.Params = GenInet, map[string]any{"version": "v4"}
	case n == "list" || n == "set" || n == "map":
		s.Gen, s.Params = GenCollection, map[string]any{"min": 0, "max": 3}
		if n == "map" {
			s.Key = DefaultSpec("", td.Args[0], true, now)
			s.Element = DefaultSpec("", td.Args[1], false, now)
		} else {
			s.Element = DefaultSpec("", td.Args[0], n == "set", now)
		}
	case n == "tuple":
		s.Gen, s.Fields = GenComposite, map[string]*Spec{}
	case n == "vector":
		s.Gen, s.Params = GenVector, map[string]any{"min": -1, "max": 1, "decimals": 4}
	case td.UDT != nil:
		s.Gen, s.Fields = GenComposite, map[string]*Spec{}
	default:
		s.Gen, s.Params = GenNull, nil
	}
	return s
}
