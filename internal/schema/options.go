package schema

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// notOptions are system_schema.tables / views columns that are not table options.
var notOptions = map[string]bool{
	"keyspace_name": true, "table_name": true, "view_name": true, "id": true, "flags": true,
	"base_table_id": true, "base_table_name": true, "where_clause": true, "include_all_columns": true,
}

// quote renders s as a CQL string literal.
func quote(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

func literalMap(m map[string]string) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, len(keys))
	for i, k := range keys {
		parts[i] = quote(k) + ": " + quote(m[k])
	}
	return "{" + strings.Join(parts, ", ") + "}"
}

func literalFloat(f float64, bits int) string {
	s := strconv.FormatFloat(f, 'f', -1, bits)
	if !strings.ContainsAny(s, ".") {
		s += ".0"
	}
	return s
}

func optionLiteral(name string, v any) (string, bool) {
	switch x := v.(type) {
	case string:
		if name == "memtable" && x == "" {
			return quote("default"), true
		}
		return quote(x), true
	case bool:
		return strconv.FormatBool(x), true
	case int:
		return strconv.Itoa(x), true
	case int64:
		return strconv.FormatInt(x, 10), true
	case float32:
		return literalFloat(float64(x), 32), true
	case float64:
		return literalFloat(x, 64), true
	case map[string]string:
		return literalMap(x), true
	case map[string][]byte:
		if len(x) == 0 {
			return "{}", true
		}
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		parts := make([]string, len(keys))
		for i, k := range keys {
			parts[i] = fmt.Sprintf("%s: 0x%x", quote(k), x[k])
		}
		return "{" + strings.Join(parts, ", ") + "}", true
	}
	return "", false
}

// tableOptions turns a system_schema row into options in DESCRIBE order: alphabetical,
// with memtable following compression.
func tableOptions(r row) []Option {
	names := make([]string, 0, len(r))
	// 4.0 removed the *_read_repair_chance options but still stores them.
	_, v4 := r["read_repair"]
	for k := range r {
		if !notOptions[k] && !(v4 && (k == "read_repair_chance" || k == "dclocal_read_repair_chance")) {
			names = append(names, k)
		}
	}
	sort.Strings(names)
	out := []Option{}
	for _, n := range names {
		lit, ok := optionLiteral(n, r[n])
		if !ok {
			continue
		}
		out = append(out, Option{Name: n, Value: lit})
	}
	// Move memtable right after compression.
	mi, ci := -1, -1
	for i, o := range out {
		switch o.Name {
		case "memtable":
			mi = i
		case "compression":
			ci = i
		}
	}
	if mi >= 0 && ci >= 0 && mi != ci+1 {
		m := out[mi]
		out = append(out[:mi], out[mi+1:]...)
		if mi < ci {
			ci--
		}
		out = append(out[:ci+1], append([]Option{m}, out[ci+1:]...)...)
	}
	return out
}
