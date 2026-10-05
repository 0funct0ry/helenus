package seed

import (
	"encoding/json"
	"fmt"
	"math"
	"math/rand/v2"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/0funct0ry/helenus/internal/codec"
)

// Generator produces one value in the codec JSON form per call. Generators are
// stateful (sequences) and used from a single goroutine.
type Generator interface{ Next(rng *rand.Rand) any }

// Generator names.
const (
	GenConstant   = "constant"
	GenNull       = "null"
	GenSequence   = "sequence"
	GenUUID       = "uuid"
	GenTimeUUID   = "timeuuid"
	GenIntRange   = "int_range"
	GenFloatRange = "float_range"
	GenDecimal    = "decimal_range"
	GenBoolean    = "boolean"
	GenChoice     = "choice"
	GenTimeRange  = "time_range"
	GenDuration   = "duration_range"
	GenInet       = "inet"
	GenBlob       = "blob"
	GenRegex      = "regex"
	GenFake       = "fake"
	GenCollection = "collection"
	GenComposite  = "composite"
	GenVector     = "vector"
)

func isInt(n string) bool {
	switch n {
	case "tinyint", "smallint", "int", "bigint", "varint":
		return true
	}
	return false
}

func isText(n string) bool { return n == "text" || n == "ascii" || n == "varchar" }

func isUDT(td codec.TypeDesc) bool { return td.UDT != nil }

// Compatible lists the generators that can fill a column of type td.
func Compatible(td codec.TypeDesc) []string {
	n := td.Name
	var out []string
	switch {
	case n == "counter":
		return []string{GenIntRange}
	case n == "list" || n == "set" || n == "map":
		out = []string{GenCollection}
	case n == "tuple" || isUDT(td):
		out = []string{GenComposite}
	case n == "vector":
		out = []string{GenVector}
	default:
		if isInt(n) || isText(n) {
			out = append(out, GenSequence)
		}
		switch {
		case isInt(n):
			out = append(out, GenIntRange)
		case n == "float" || n == "double":
			out = append(out, GenFloatRange)
		case n == "decimal":
			out = append(out, GenDecimal)
		case n == "boolean":
			out = append(out, GenBoolean)
		case n == "uuid":
			out = append(out, GenUUID)
		case n == "timeuuid":
			out = append(out, GenTimeUUID)
		case n == "timestamp" || n == "date" || n == "time":
			out = append(out, GenTimeRange)
		case n == "duration":
			out = append(out, GenDuration)
		case n == "inet":
			out = append(out, GenInet, GenFake)
		case n == "blob":
			out = append(out, GenBlob)
		case isText(n):
			out = append(out, GenRegex, GenFake)
		}
		if n == "date" {
			out = append(out, GenFake)
		}
		out = append(out, GenChoice)
	}
	return append([]string{GenConstant, GenNull}, out...)
}

func compatible(td codec.TypeDesc, gen string) bool {
	for _, g := range Compatible(td) {
		if g == gen {
			return true
		}
	}
	return false
}

type builder struct {
	now  time.Time
	udt  codec.UDTFieldTypes
	sink *errSink
}

// build creates the generator for spec at path. key marks primary-key columns
// (no nulls). It returns nil after recording field errors.
func (b *builder) build(path string, spec *Spec, td codec.TypeDesc, key bool) Generator {
	if spec == nil {
		spec = &Spec{}
	}
	n0 := len(b.sink.errs)
	if spec.Gen == "" {
		b.sink.add(path, "choose a generator")
		return nil
	}
	if !compatible(td, spec.Gen) {
		b.sink.add(path, "generator %q cannot fill a %s column", spec.Gen, td.Name)
		return nil
	}
	if spec.NullPercent < 0 || spec.NullPercent > 100 {
		b.sink.add(path+".null_percent", "null percent must be between 0 and 100")
	}
	if key && (spec.NullPercent > 0 || spec.Gen == GenNull) {
		b.sink.add(path, "primary key columns cannot be null")
		return nil
	}
	if td.Name == "counter" && spec.NullPercent > 0 {
		b.sink.add(path+".null_percent", "counter columns cannot be null")
	}
	p := params{m: spec.Params, path: path, sink: b.sink}
	g := b.gen(path, spec, p, td)
	if g == nil || len(b.sink.errs) > n0 {
		return nil
	}
	if spec.NullPercent > 0 {
		return nullable{g, float64(spec.NullPercent)}
	}
	return g
}

type nullable struct {
	g   Generator
	pct float64
}

func (n nullable) Next(rng *rand.Rand) any {
	if rng.Float64()*100 < n.pct {
		return nil
	}
	return n.g.Next(rng)
}

type fn func(rng *rand.Rand) any

func (f fn) Next(rng *rand.Rand) any { return f(rng) }

func (b *builder) gen(path string, spec *Spec, p params, td codec.TypeDesc) Generator {
	n := td.Name
	switch spec.Gen {
	case GenNull:
		return fn(func(*rand.Rand) any { return nil })
	case GenConstant:
		if !p.has("value") {
			b.sink.add(p.fieldOf("value"), "value is required")
			return nil
		}
		v := p.m["value"]
		if err := b.validate(v, td); err != nil {
			b.sink.add(p.fieldOf("value"), "%s", err)
			return nil
		}
		return fn(func(*rand.Rand) any { return v })
	case GenSequence:
		start, step := p.int("start", 1), p.int("step", 1)
		prefix := p.str("prefix", "")
		if isInt(n) && prefix != "" {
			b.sink.add(p.fieldOf("prefix"), "prefix only applies to text columns")
		}
		cur := start
		return fn(func(*rand.Rand) any {
			v := cur
			cur += step
			if isText(n) {
				return prefix + strconv.FormatInt(v, 10)
			}
			return v
		})
	case GenUUID:
		return fn(func(rng *rand.Rand) any { return uuidV4(rng) })
	case GenTimeUUID:
		from, to := b.timeBounds(p, "now-30d", "now")
		return fn(func(rng *rand.Rand) any { return timeUUID(randTime(rng, from, to), rng) })
	case GenIntRange:
		lo, hi := typeBounds(n)
		def := [2]int64{0, 1000}
		if n == "counter" {
			def = [2]int64{1, 10}
		}
		min, max := p.int("min", def[0]), p.int("max", def[1])
		if min > max {
			b.sink.add(p.fieldOf("min"), "min must not exceed max")
			return nil
		}
		if min < lo || max > hi {
			b.sink.add(p.fieldOf("max"), "range must fit %s (%d to %d)", n, lo, hi)
			return nil
		}
		span := uint64(max-min) + 1
		return fn(func(rng *rand.Rand) any {
			if span == 0 {
				return int64(rng.Uint64())
			}
			return min + int64(rng.Uint64N(span))
		})
	case GenFloatRange, GenDecimal:
		min, max := p.num("min", 0), p.num("max", 1000)
		dec := int(p.int("decimals", 2))
		if min > max {
			b.sink.add(p.fieldOf("min"), "min must not exceed max")
			return nil
		}
		if dec < 0 || dec > 10 {
			b.sink.add(p.fieldOf("decimals"), "decimals must be between 0 and 10")
			return nil
		}
		scale := math.Pow10(dec)
		text := spec.Gen == GenDecimal
		return fn(func(rng *rand.Rand) any {
			v := math.Round((min+rng.Float64()*(max-min))*scale) / scale
			if text {
				return strconv.FormatFloat(v, 'f', dec, 64)
			}
			return v
		})
	case GenBoolean:
		pt := p.num("p_true", 0.5)
		if pt < 0 || pt > 1 {
			b.sink.add(p.fieldOf("p_true"), "p_true must be between 0 and 1")
			return nil
		}
		return fn(func(rng *rand.Rand) any { return rng.Float64() < pt })
	case GenChoice:
		return b.choice(p, td)
	case GenTimeRange:
		return b.timeRange(p, td)
	case GenDuration:
		min, max := p.int("min_seconds", 60), p.int("max_seconds", 86400)
		if min < 0 || min > max {
			b.sink.add(p.fieldOf("min_seconds"), "min_seconds must be between 0 and max_seconds")
			return nil
		}
		return fn(func(rng *rand.Rand) any { return durationText(min + rng.Int64N(max-min+1)) })
	case GenInet:
		return inetGen(b, p)
	case GenBlob:
		min, max := p.int("min_len", 8), p.int("max_len", 32)
		if min < 0 || max > 4096 || min > max {
			b.sink.add(p.fieldOf("min_len"), "blob length must satisfy 0 <= min_len <= max_len <= 4096")
			return nil
		}
		return fn(func(rng *rand.Rand) any {
			l := int(min + rng.Int64N(max-min+1))
			var sb strings.Builder
			sb.WriteString("0x")
			for i := 0; i < l; i++ {
				fmt.Fprintf(&sb, "%02x", rng.IntN(256))
			}
			return sb.String()
		})
	case GenRegex:
		pat := p.str("pattern", "")
		if pat == "" {
			b.sink.add(p.fieldOf("pattern"), "pattern is required")
			return nil
		}
		g, err := newRegexGen(pat)
		if err != nil {
			b.sink.add(p.fieldOf("pattern"), "%s", err)
			return nil
		}
		return g
	case GenFake:
		return b.fake(p, td)
	case GenCollection:
		return b.collection(path, spec, p, td)
	case GenComposite:
		return b.composite(path, spec, td)
	case GenVector:
		min, max := p.num("min", -1), p.num("max", 1)
		dec := int(p.int("decimals", 4))
		if min > max || dec < 0 || dec > 10 {
			b.sink.add(p.fieldOf("min"), "need min <= max and 0 <= decimals <= 10")
			return nil
		}
		dim, scale := td.Size, math.Pow10(dec)
		return fn(func(rng *rand.Rand) any {
			out := make([]any, dim)
			for i := range out {
				out[i] = math.Round((min+rng.Float64()*(max-min))*scale) / scale
			}
			return out
		})
	}
	b.sink.add(path, "unknown generator %q", spec.Gen)
	return nil
}

func (b *builder) validate(v any, td codec.TypeDesc) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = codec.Decode(raw, td, b.udt)
	return err
}

func typeBounds(n string) (int64, int64) {
	switch n {
	case "tinyint":
		return math.MinInt8, math.MaxInt8
	case "smallint":
		return math.MinInt16, math.MaxInt16
	case "int":
		return math.MinInt32, math.MaxInt32
	}
	return math.MinInt64, math.MaxInt64
}

func (b *builder) choice(p params, td codec.TypeDesc) Generator {
	vals := p.list("values")
	if len(vals) == 0 {
		b.sink.add(p.fieldOf("values"), "give at least one value")
		return nil
	}
	for i, v := range vals {
		if err := b.validate(v, td); err != nil {
			b.sink.add(p.fieldOf("values"), "value %d: %s", i+1, err)
			return nil
		}
	}
	cum := make([]float64, len(vals))
	total := 0.0
	ws := p.list("weights")
	if ws != nil && len(ws) != len(vals) {
		b.sink.add(p.fieldOf("weights"), "give one weight per value")
		return nil
	}
	for i := range vals {
		w := 1.0
		if ws != nil {
			f, ok := toFloat(ws[i])
			if !ok || f < 0 {
				b.sink.add(p.fieldOf("weights"), "weights must be numbers >= 0")
				return nil
			}
			w = f
		}
		total += w
		cum[i] = total
	}
	if total <= 0 {
		b.sink.add(p.fieldOf("weights"), "weights must not all be zero")
		return nil
	}
	return fn(func(rng *rand.Rand) any {
		x := rng.Float64() * total
		i := sort.SearchFloat64s(cum, x)
		if i >= len(vals) {
			i = len(vals) - 1
		}
		return vals[i]
	})
}

func (b *builder) fake(p params, td codec.TypeDesc) Generator {
	cat := p.str("category", "")
	if cat == "" {
		cat = map[string]string{"inet": "ipv4", "date": "birthdate"}[td.Name]
		if cat == "" {
			cat = "word"
		}
	}
	ok := false
	for _, c := range FakeCategories {
		ok = ok || c == cat
	}
	if !ok {
		b.sink.add(p.fieldOf("category"), "unknown category %q", cat)
		return nil
	}
	if td.Name == "inet" && cat != "ipv4" && cat != "ipv6" {
		b.sink.add(p.fieldOf("category"), "inet columns accept ipv4 or ipv6")
		return nil
	}
	if td.Name == "date" && cat != "birthdate" {
		b.sink.add(p.fieldOf("category"), "date columns accept birthdate")
		return nil
	}
	now := b.now
	return fn(func(rng *rand.Rand) any { return fakeText(cat, rng, now) })
}

func (b *builder) collection(path string, spec *Spec, p params, td codec.TypeDesc) Generator {
	min, max := p.int("min", 0), p.int("max", 3)
	if min < 0 || max > MaxCollection || min > max {
		b.sink.add(p.fieldOf("min"), "size must satisfy 0 <= min <= max <= %d", MaxCollection)
		return nil
	}
	sub := func(s *Spec, sp string, t codec.TypeDesc) Generator {
		if s == nil {
			s = DefaultSpec("", t, false, b.now)
		}
		if s.NullPercent != 0 {
			b.sink.add(path+"."+sp+".null_percent", "collection elements cannot be null")
			return nil
		}
		return b.build(path+"."+sp, s, t, true)
	}
	if td.Name == "map" {
		kg, vg := sub(spec.Key, "key", td.Args[0]), sub(spec.Element, "element", td.Args[1])
		if kg == nil || vg == nil {
			return nil
		}
		return fn(func(rng *rand.Rand) any {
			size := int(min + rng.Int64N(max-min+1))
			seen := map[string]bool{}
			out := make([]any, 0, size)
			for tries := 0; len(out) < size && tries < size*10; tries++ {
				k := kg.Next(rng)
				id := keyText(k)
				if seen[id] {
					continue
				}
				seen[id] = true
				out = append(out, []any{k, vg.Next(rng)})
			}
			return out
		})
	}
	eg := sub(spec.Element, "element", td.Args[0])
	if eg == nil {
		return nil
	}
	set := td.Name == "set"
	return fn(func(rng *rand.Rand) any {
		size := int(min + rng.Int64N(max-min+1))
		seen := map[string]bool{}
		out := make([]any, 0, size)
		for tries := 0; len(out) < size && tries < size*10; tries++ {
			v := eg.Next(rng)
			if set {
				id := keyText(v)
				if seen[id] {
					continue
				}
				seen[id] = true
			}
			out = append(out, v)
		}
		return out
	})
}

func keyText(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func (b *builder) composite(path string, spec *Spec, td codec.TypeDesc) Generator {
	type field struct {
		name string
		g    Generator
	}
	var fields []field
	var names []string
	types := map[string]codec.TypeDesc{}
	tuple := td.Name == "tuple"
	if tuple {
		for i, a := range td.Args {
			n := strconv.Itoa(i)
			names, types[n] = append(names, n), a
		}
	} else {
		var ft map[string]codec.TypeDesc
		if b.udt != nil {
			ft = b.udt(*td.UDT)
		}
		if ft == nil {
			b.sink.add(path, "unknown user-defined type %s.%s", td.UDT.Keyspace, td.UDT.Name)
			return nil
		}
		for n, t := range ft {
			names, types[n] = append(names, n), t
		}
		sort.Strings(names)
	}
	failed := false
	for _, n := range names {
		fs := spec.Fields[n]
		if fs == nil {
			fs = DefaultSpec(n, types[n], false, b.now)
		}
		g := b.build(path+".fields."+n, fs, types[n], false)
		if g == nil {
			failed = true
		}
		fields = append(fields, field{n, g})
	}
	if failed {
		return nil
	}
	return fn(func(rng *rand.Rand) any {
		if tuple {
			out := make([]any, len(fields))
			for i, f := range fields {
				out[i] = f.g.Next(rng)
			}
			return out
		}
		out := make(map[string]any, len(fields))
		for _, f := range fields {
			out[f.name] = f.g.Next(rng)
		}
		return out
	})
}
