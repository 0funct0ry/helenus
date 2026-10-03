package codec

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"net"
	"reflect"
	"strconv"
	"strings"
	"time"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
	"gopkg.in/inf.v0"
)

// UDTFieldTypes resolves the field types of a user-defined type. It is the
// same shape as Encoder.UDTFields.
type UDTFieldTypes func(UDTRef) map[string]TypeDesc

// Map is a CQL map whose keys cannot be Go map keys (blobs and frozen
// collections). It marshals itself, so it can be bound like any other value.
type Map struct {
	Keys   []any
	Values []any
}

// MarshalCQL implements gocql.Marshaler.
func (m Map) MarshalCQL(info gocql.TypeInfo) ([]byte, error) {
	var ct gocql.CollectionType
	switch x := info.(type) {
	case gocql.CollectionType:
		ct = x
	case *gocql.CollectionType:
		ct = *x
	default:
		return nil, fmt.Errorf("cannot marshal a map into %T", info)
	}
	var buf bytes.Buffer
	size := func(n int) {
		buf.Write([]byte{byte(n >> 24), byte(n >> 16), byte(n >> 8), byte(n)})
	}
	size(len(m.Keys))
	for i := range m.Keys {
		for _, side := range []struct {
			v  any
			ti gocql.TypeInfo
		}{{m.Keys[i], ct.Key}, {m.Values[i], ct.Elem}} {
			b, err := gocql.Marshal(side.ti, side.v)
			if err != nil {
				return nil, err
			}
			if b == nil {
				size(-1)
				continue
			}
			size(len(b))
			buf.Write(b)
		}
	}
	return buf.Bytes(), nil
}

// Decode converts a JSON value, encoded as in SPEC §7.3, into the Go value the
// driver binds for a column of type td. A JSON null decodes to nil.
func Decode(raw json.RawMessage, td TypeDesc, udt UDTFieldTypes) (any, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil, nil
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}
	return decodeValue(v, td, udt)
}

func decodeValue(v any, td TypeDesc, udt UDTFieldTypes) (any, error) {
	if v == nil {
		return nil, nil
	}
	switch td.Name {
	case "ascii", "text", "varchar":
		s, ok := v.(string)
		if !ok {
			return nil, wantErr(td, "a string")
		}
		return s, nil
	case "boolean":
		b, ok := v.(bool)
		if !ok {
			return nil, wantErr(td, "true or false")
		}
		return b, nil
	case "tinyint":
		n, err := intOf(v, td, 8)
		if err != nil {
			return nil, err
		}
		return int8(n), nil
	case "smallint":
		n, err := intOf(v, td, 16)
		if err != nil {
			return nil, err
		}
		return int16(n), nil
	case "int":
		n, err := intOf(v, td, 32)
		if err != nil {
			return nil, err
		}
		return int32(n), nil
	case "bigint", "counter":
		return intOf(v, td, 64)
	case "varint":
		s, err := numText(v, td)
		if err != nil {
			return nil, err
		}
		n, ok := new(big.Int).SetString(s, 10)
		if !ok {
			return nil, wantErr(td, "an integer")
		}
		return n, nil
	case "decimal":
		s, err := numText(v, td)
		if err != nil {
			return nil, err
		}
		d, ok := new(inf.Dec).SetString(s)
		if !ok {
			return nil, wantErr(td, "a decimal number")
		}
		return d, nil
	case "float":
		f, err := floatOf(v, td, 32)
		if err != nil {
			return nil, err
		}
		return float32(f), nil
	case "double":
		return floatOf(v, td, 64)
	case "uuid", "timeuuid":
		s, ok := v.(string)
		if !ok {
			return nil, wantErr(td, "a UUID string")
		}
		u, err := gocql.ParseUUID(s)
		if err != nil {
			return nil, fmt.Errorf("%s: %q is not a valid UUID", td.Name, s)
		}
		if td.Name == "timeuuid" && u.Version() != 1 {
			return nil, fmt.Errorf("timeuuid: %q is not a version 1 UUID", s)
		}
		return u, nil
	case "inet":
		s, ok := v.(string)
		if !ok {
			return nil, wantErr(td, "an IP address string")
		}
		ip := net.ParseIP(s)
		if ip == nil {
			return nil, fmt.Errorf("inet: %q is not a valid IP address", s)
		}
		return ip, nil
	case "blob":
		s, ok := v.(string)
		if !ok {
			return nil, wantErr(td, "a 0x… hex string (truncated blobs cannot be edited)")
		}
		return blobOf(s)
	case "timestamp":
		s, ok := v.(string)
		if !ok {
			return nil, wantErr(td, "an ISO-8601 string")
		}
		return timestampOf(s)
	case "date":
		s, ok := v.(string)
		if !ok {
			return nil, wantErr(td, "a YYYY-MM-DD string")
		}
		t, err := time.Parse("2006-01-02", s)
		if err != nil {
			return nil, fmt.Errorf("date: %q is not a YYYY-MM-DD date", s)
		}
		return t, nil
	case "time":
		s, ok := v.(string)
		if !ok {
			return nil, wantErr(td, "a HH:MM:SS[.nnnnnnnnn] string")
		}
		return timeOf(s)
	case "duration":
		s, ok := v.(string)
		if !ok {
			return nil, wantErr(td, "a duration string such as 1mo2d3h")
		}
		return ParseDuration(s)
	case "list", "set":
		arr, ok := v.([]any)
		if !ok {
			return nil, wantErr(td, "an array")
		}
		el := firstArg(td)
		out := make([]any, len(arr))
		for i, x := range arr {
			if x == nil {
				return nil, fmt.Errorf("%s: element %d is null; collections cannot hold null", td.Name, i)
			}
			d, err := decodeValue(x, el, udt)
			if err != nil {
				return nil, fmt.Errorf("%s element %d: %w", td.Name, i, err)
			}
			out[i] = d
		}
		return out, nil
	case "vector":
		arr, ok := v.([]any)
		if !ok {
			return nil, wantErr(td, "an array")
		}
		if td.Size > 0 && len(arr) != td.Size {
			return nil, fmt.Errorf("vector needs exactly %d elements, got %d", td.Size, len(arr))
		}
		out := make([]any, len(arr))
		for i, x := range arr {
			d, err := decodeValue(x, firstArg(td), udt)
			if err != nil {
				return nil, fmt.Errorf("vector element %d: %w", i, err)
			}
			out[i] = d
		}
		return out, nil
	case "tuple":
		arr, ok := v.([]any)
		if !ok {
			return nil, wantErr(td, "an array")
		}
		if len(arr) != len(td.Args) {
			return nil, fmt.Errorf("tuple needs %d elements, got %d", len(td.Args), len(arr))
		}
		out := make([]any, len(arr))
		for i, x := range arr {
			d, err := decodeValue(x, td.Args[i], udt)
			if err != nil {
				return nil, fmt.Errorf("tuple element %d: %w", i, err)
			}
			out[i] = d
		}
		return out, nil
	case "map":
		return mapOf(v, td, udt)
	}
	if td.UDT != nil {
		return udtOf(v, td, udt)
	}
	return nil, fmt.Errorf("unsupported type %q", td.Name)
}

func wantErr(td TypeDesc, want string) error {
	return fmt.Errorf("%s: expected %s", td.Name, want)
}

func firstArg(td TypeDesc) TypeDesc {
	if len(td.Args) > 0 {
		return td.Args[0]
	}
	return TypeDesc{}
}

func numText(v any, td TypeDesc) (string, error) {
	switch x := v.(type) {
	case json.Number:
		return x.String(), nil
	case string:
		return strings.TrimSpace(x), nil
	}
	return "", wantErr(td, "a number or numeric string")
}

func intOf(v any, td TypeDesc, bits int) (int64, error) {
	s, err := numText(v, td)
	if err != nil {
		return 0, err
	}
	n, err := strconv.ParseInt(s, 10, bits)
	if err != nil {
		if ne, ok := err.(*strconv.NumError); ok && ne.Err == strconv.ErrRange {
			return 0, fmt.Errorf("%s: %s is out of range", td.Name, s)
		}
		return 0, wantErr(td, "an integer")
	}
	return n, nil
}

func floatOf(v any, td TypeDesc, bits int) (float64, error) {
	s, err := numText(v, td)
	if err != nil {
		return 0, err
	}
	switch s {
	case "NaN":
		return math.NaN(), nil
	case "Infinity":
		return math.Inf(1), nil
	case "-Infinity":
		return math.Inf(-1), nil
	}
	f, err := strconv.ParseFloat(s, bits)
	if err != nil {
		if ne, ok := err.(*strconv.NumError); ok && ne.Err == strconv.ErrRange {
			return 0, fmt.Errorf("%s: %s is out of range", td.Name, s)
		}
		return 0, wantErr(td, "a number")
	}
	return f, nil
}

func blobOf(s string) ([]byte, error) {
	if !strings.HasPrefix(s, "0x") && !strings.HasPrefix(s, "0X") {
		return nil, fmt.Errorf("blob: %q must start with 0x", s)
	}
	b, err := hex.DecodeString(s[2:])
	if err != nil {
		return nil, fmt.Errorf("blob: %q is not valid hex", s)
	}
	if b == nil {
		b = []byte{}
	}
	return b, nil
}

var timestampLayouts = []string{
	time.RFC3339Nano,
	"2006-01-02T15:04:05.999999999",
	"2006-01-02 15:04:05.999999999Z07:00",
	"2006-01-02 15:04:05.999999999",
	"2006-01-02T15:04",
	"2006-01-02",
}

func timestampOf(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	for _, l := range timestampLayouts {
		if t, err := time.Parse(l, s); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("timestamp: %q is not an ISO-8601 timestamp", s)
}

func timeOf(s string) (time.Duration, error) {
	bad := fmt.Errorf("time: %q is not HH:MM:SS[.nnnnnnnnn]", s)
	parts := strings.Split(s, ":")
	if len(parts) != 3 {
		return 0, bad
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	secPart, frac, _ := strings.Cut(parts[2], ".")
	sec, err3 := strconv.Atoi(secPart)
	if err1 != nil || err2 != nil || err3 != nil || h < 0 || h > 23 || m < 0 || m > 59 || sec < 0 || sec > 59 {
		return 0, bad
	}
	var ns int64
	if frac != "" {
		if len(frac) > 9 {
			return 0, bad
		}
		n, err := strconv.ParseInt(frac+strings.Repeat("0", 9-len(frac)), 10, 64)
		if err != nil {
			return 0, bad
		}
		ns = n
	}
	return time.Duration(h)*time.Hour + time.Duration(m)*time.Minute + time.Duration(sec)*time.Second + time.Duration(ns), nil
}

func mapOf(v any, td TypeDesc, udt UDTFieldTypes) (any, error) {
	arr, ok := v.([]any)
	if !ok {
		return nil, wantErr(td, "an array of [key, value] pairs")
	}
	if len(td.Args) != 2 {
		return nil, fmt.Errorf("map type has no key and value types")
	}
	keys := make([]any, len(arr))
	vals := make([]any, len(arr))
	hashable := true
	for i, p := range arr {
		kv, ok := p.([]any)
		if !ok || len(kv) != 2 {
			return nil, fmt.Errorf("map entry %d must be a [key, value] pair", i)
		}
		if kv[0] == nil || kv[1] == nil {
			return nil, fmt.Errorf("map entry %d: keys and values cannot be null", i)
		}
		k, err := decodeValue(kv[0], td.Args[0], udt)
		if err != nil {
			return nil, fmt.Errorf("map key %d: %w", i, err)
		}
		val, err := decodeValue(kv[1], td.Args[1], udt)
		if err != nil {
			return nil, fmt.Errorf("map value %d: %w", i, err)
		}
		keys[i], vals[i] = k, val
		if !reflect.TypeOf(k).Comparable() {
			hashable = false
		}
	}
	if hashable {
		seen := make(map[string]bool, len(keys))
		out := make(map[any]any, len(arr))
		for i, k := range keys {
			// Pointer keys (varint, decimal) compare by identity; detect duplicates by value.
			text := fmt.Sprint(k)
			if seen[text] {
				return nil, fmt.Errorf("map key %d is a duplicate", i)
			}
			seen[text] = true
			out[k] = vals[i]
		}
		return out, nil
	}
	return Map{Keys: keys, Values: vals}, nil
}

func udtOf(v any, td TypeDesc, udt UDTFieldTypes) (any, error) {
	obj, ok := v.(map[string]any)
	if !ok {
		return nil, wantErr(td, "an object keyed by field name")
	}
	var fields map[string]TypeDesc
	if udt != nil {
		fields = udt(*td.UDT)
	}
	if fields == nil {
		return nil, fmt.Errorf("unknown user-defined type %s.%s", td.UDT.Keyspace, td.UDT.Name)
	}
	out := make(map[string]any, len(obj))
	for name, x := range obj {
		ft, ok := fields[name]
		if !ok {
			return nil, fmt.Errorf("%s has no field %q", td.Name, name)
		}
		d, err := decodeValue(x, ft, udt)
		if err != nil {
			return nil, fmt.Errorf("field %s: %w", name, err)
		}
		out[name] = d
	}
	return out, nil
}

// ParseDuration reads a CQL duration literal such as 1y2mo3w4d5h6m7s8ms9us10ns
// (the inverse of FormatDuration). A leading '-' negates every component.
func ParseDuration(s string) (gocql.Duration, error) {
	bad := fmt.Errorf("duration: %q is not a duration such as 1mo2d3h4m", s)
	in := strings.TrimSpace(s)
	neg := strings.HasPrefix(in, "-")
	in = strings.TrimPrefix(in, "-")
	if in == "" {
		return gocql.Duration{}, bad
	}
	var months, days, ns int64
	for in != "" {
		i := 0
		for i < len(in) && in[i] >= '0' && in[i] <= '9' {
			i++
		}
		if i == 0 {
			return gocql.Duration{}, bad
		}
		n, err := strconv.ParseInt(in[:i], 10, 64)
		if err != nil {
			return gocql.Duration{}, bad
		}
		in = in[i:]
		j := 0
		for j < len(in) && !(in[j] >= '0' && in[j] <= '9') {
			j++
		}
		unit := in[:j]
		in = in[j:]
		switch unit {
		case "y":
			months += 12 * n
		case "mo":
			months += n
		case "w":
			days += 7 * n
		case "d":
			days += n
		case "h":
			ns += n * int64(time.Hour)
		case "m":
			ns += n * int64(time.Minute)
		case "s":
			ns += n * int64(time.Second)
		case "ms":
			ns += n * int64(time.Millisecond)
		case "us", "µs":
			ns += n * int64(time.Microsecond)
		case "ns":
			ns += n
		default:
			return gocql.Duration{}, bad
		}
	}
	if months > math.MaxInt32 || days > math.MaxInt32 {
		return gocql.Duration{}, fmt.Errorf("duration: %q is out of range", s)
	}
	if neg {
		months, days, ns = -months, -days, -ns
	}
	return gocql.Duration{Months: int32(months), Days: int32(days), Nanoseconds: ns}, nil
}
