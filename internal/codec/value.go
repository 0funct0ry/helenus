package codec

import (
	"encoding/hex"
	"fmt"
	"math"
	"net"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
)

// DefaultBlobLimit is the largest blob cell sent in full (SPEC §7.3).
const DefaultBlobLimit = 64 * 1024

// Truncated replaces a blob cell larger than the limit.
type Truncated struct {
	Truncated bool   `json:"$truncated"`
	Preview   string `json:"preview"`
	Bytes     int    `json:"bytes"`
}

// Encoder converts driver values into the JSON and text forms of SPEC §7.3.
type Encoder struct {
	// BlobLimit is the largest blob in bytes encoded in full; 0 means unlimited.
	BlobLimit int
	// UDTFields resolves a user-defined type's field types. Optional: without it
	// UDT fields are encoded from their Go type alone.
	UDTFields func(UDTRef) map[string]TypeDesc
}

// JSON encodes v, a value scanned from a column of type td, for the API.
// A nil v is null.
func (e Encoder) JSON(v any, td TypeDesc) any {
	return e.enc(v, td, false)
}

func (e Encoder) enc(v any, td TypeDesc, text bool) any {
	v = deref(v)
	if v == nil {
		return nil
	}
	switch x := v.(type) {
	case string:
		return x
	case int8, int16, int32, int:
		return x
	case int64:
		return strconv.FormatInt(x, 10)
	case uint8, uint16, uint32:
		return x
	case uint64:
		return strconv.FormatUint(x, 10)
	case bool:
		return x
	case float32:
		return floatJSON(float64(x), strconv.FormatFloat(float64(x), 'g', -1, 32))
	case float64:
		return floatJSON(x, strconv.FormatFloat(x, 'g', -1, 64))
	case gocql.UUID:
		return x.String()
	case net.IP:
		return x.String()
	case gocql.Duration:
		return FormatDuration(x)
	case time.Duration:
		return formatTime(x)
	case time.Time:
		if td.Name == "date" {
			return x.UTC().Format("2006-01-02")
		}
		if text {
			return x.UTC().Format("2006-01-02 15:04:05.000Z")
		}
		return x.UTC().Format("2006-01-02T15:04:05.000Z")
	case []byte:
		return e.blob(x)
	case fmt.Stringer: // *big.Int, *inf.Dec
		return x.String()
	}
	rv := reflect.ValueOf(v)
	switch rv.Kind() {
	case reflect.Slice, reflect.Array:
		var el TypeDesc
		if len(td.Args) > 0 {
			el = td.Args[0]
		}
		out := make([]any, rv.Len())
		for i := range out {
			if td.Name == "tuple" && i < len(td.Args) {
				el = td.Args[i]
			}
			out[i] = e.enc(rv.Index(i).Interface(), el, text)
		}
		return out
	case reflect.Map:
		if rv.Type().Key().Kind() == reflect.String && td.UDT != nil || td.Name == "" && rv.Type().Elem().Kind() == reflect.Interface && rv.Type().Key().Kind() == reflect.String {
			return e.udt(rv, td, text)
		}
		var kt, vt TypeDesc
		if len(td.Args) == 2 {
			kt, vt = td.Args[0], td.Args[1]
		}
		type pair struct {
			sortKey string
			kv      [2]any
		}
		pairs := make([]pair, 0, rv.Len())
		for _, k := range rv.MapKeys() {
			ek := e.enc(k.Interface(), kt, text)
			pairs = append(pairs, pair{fmt.Sprint(ek), [2]any{ek, e.enc(rv.MapIndex(k).Interface(), vt, text)}})
		}
		sort.Slice(pairs, func(i, j int) bool { return pairs[i].sortKey < pairs[j].sortKey })
		out := make([]any, len(pairs))
		for i, p := range pairs {
			out[i] = []any{p.kv[0], p.kv[1]}
		}
		return out
	}
	return fmt.Sprint(v)
}

func (e Encoder) udt(rv reflect.Value, td TypeDesc, text bool) any {
	var fields map[string]TypeDesc
	if td.UDT != nil && e.UDTFields != nil {
		fields = e.UDTFields(*td.UDT)
	}
	// Ordered object: keep field order stable for display.
	keys := make([]string, 0, rv.Len())
	for _, k := range rv.MapKeys() {
		keys = append(keys, k.String())
	}
	sort.Strings(keys)
	out := &OrderedObject{Keys: keys, Values: map[string]any{}}
	for _, k := range keys {
		out.Values[k] = e.enc(rv.MapIndex(reflect.ValueOf(k)).Interface(), fields[k], text)
	}
	return out
}

func deref(v any) any {
	for v != nil {
		rv := reflect.ValueOf(v)
		if rv.Kind() != reflect.Pointer {
			break
		}
		if rv.IsNil() {
			return nil
		}
		if _, ok := v.(fmt.Stringer); ok { // *big.Int, *inf.Dec
			return v
		}
		v = rv.Elem().Interface()
	}
	return v
}

func floatJSON(f float64, s string) any {
	switch {
	case math.IsNaN(f):
		return "NaN"
	case math.IsInf(f, 1):
		return "Infinity"
	case math.IsInf(f, -1):
		return "-Infinity"
	}
	return jsonNumber(s)
}

func (e Encoder) blob(b []byte) any {
	if e.BlobLimit > 0 && len(b) > e.BlobLimit {
		return Truncated{Truncated: true, Preview: "0x" + hex.EncodeToString(b[:64]), Bytes: len(b)}
	}
	return "0x" + hex.EncodeToString(b)
}

func formatTime(d time.Duration) string {
	n := int64(d)
	return fmt.Sprintf("%02d:%02d:%02d.%09d", n/int64(time.Hour), n/int64(time.Minute)%60, n/int64(time.Second)%60, n%int64(time.Second))
}

// FormatDuration renders a CQL duration literal such as 1mo2d3h4m.
func FormatDuration(d gocql.Duration) string {
	neg := d.Months < 0 || d.Days < 0 || d.Nanoseconds < 0
	m, dd, ns := int64(d.Months), int64(d.Days), d.Nanoseconds
	if neg {
		m, dd, ns = -m, -dd, -ns
	}
	var b strings.Builder
	if neg {
		b.WriteByte('-')
	}
	add := func(n int64, unit string) {
		if n != 0 {
			b.WriteString(strconv.FormatInt(n, 10) + unit)
		}
	}
	add(m, "mo")
	add(dd, "d")
	add(ns/int64(time.Hour), "h")
	add(ns/int64(time.Minute)%60, "m")
	add(ns/int64(time.Second)%60, "s")
	add(ns/int64(time.Millisecond)%1000, "ms")
	add(ns/int64(time.Microsecond)%1000, "us")
	add(ns%1000, "ns")
	if b.Len() == 0 || (neg && b.Len() == 1) {
		return "0s"
	}
	return b.String()
}

// Text renders v as the shell shows it: CQL literals for collections and
// UDTs, bare values at the top level.
func (e Encoder) Text(v any, td TypeDesc) string {
	e.BlobLimit = 0
	enc := e.enc(v, td, true)
	return renderText(enc, td, true)
}

func renderText(v any, td TypeDesc, top bool) string {
	switch x := v.(type) {
	case nil:
		if top {
			return "null"
		}
		return "null"
	case string:
		switch td.Name {
		case "text", "varchar", "ascii", "":
			if td.Name == "" && strings.HasPrefix(x, "0x") {
				return x
			}
			if top {
				return x
			}
			return "'" + strings.ReplaceAll(x, "'", "''") + "'"
		}
		return x
	case jsonNumber:
		return string(x)
	case []any:
		if td.Name == "map" {
			parts := make([]string, len(x))
			for i, p := range x {
				kv := p.([]any)
				parts[i] = renderText(kv[0], td.Args[0], false) + ": " + renderText(kv[1], td.Args[1], false)
			}
			return "{" + strings.Join(parts, ", ") + "}"
		}
		parts := make([]string, len(x))
		for i, el := range x {
			t := TypeDesc{}
			if len(td.Args) > 0 {
				t = td.Args[0]
			}
			if td.Name == "tuple" && i < len(td.Args) {
				t = td.Args[i]
			}
			parts[i] = renderText(el, t, false)
		}
		switch td.Name {
		case "set":
			return "{" + strings.Join(parts, ", ") + "}"
		case "tuple":
			return "(" + strings.Join(parts, ", ") + ")"
		}
		return "[" + strings.Join(parts, ", ") + "]"
	case *OrderedObject:
		parts := make([]string, len(x.Keys))
		for i, k := range x.Keys {
			parts[i] = k + ": " + renderText(x.Values[k], TypeDesc{}, false)
		}
		return "{" + strings.Join(parts, ", ") + "}"
	case Truncated:
		return x.Preview
	}
	s := fmt.Sprint(v)
	if !top {
		switch td.Name {
		case "timestamp", "date", "time", "inet", "uuid", "timeuuid":
			if td.Name == "uuid" || td.Name == "timeuuid" {
				return s
			}
			return "'" + s + "'"
		}
	}
	return s
}
