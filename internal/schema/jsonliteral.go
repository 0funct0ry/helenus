package schema

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/cql"
)

// bareLiteral is what an unquoted literal (number, uuid, blob, duration) may contain, so a string cannot add CQL.
var bareLiteral = regexp.MustCompile(`^[A-Za-z0-9+\-.:_]+$`)

var (
	intLiteral   = regexp.MustCompile(`^-?[0-9]+$`)
	integerTypes = map[string]bool{"int": true, "bigint": true, "smallint": true, "tinyint": true, "varint": true, "counter": true}
)

// JSONLiteral renders a decoded JSON value as a CQL literal of type td.
func JSONLiteral(v any, td codec.TypeDesc, snap *Snapshot) (string, error) {
	if v == nil {
		return "null", nil
	}
	name := strings.ToLower(td.Name)
	switch {
	case td.UDT != nil:
		m, ok := v.(map[string]any)
		if !ok {
			return "", fmt.Errorf("expected an object for type %s", td.UDT.Name)
		}
		fields := snap.UDTFields(*td.UDT)
		keys := make([]string, 0, len(m))
		for k := range m {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, k := range keys {
			ft, ok := fields[k]
			if !ok {
				return "", fmt.Errorf("type %s has no field %s", td.UDT.Name, k)
			}
			l, err := JSONLiteral(m[k], ft, snap)
			if err != nil {
				return "", err
			}
			parts = append(parts, Ident(k)+": "+l)
		}
		return "{" + strings.Join(parts, ", ") + "}", nil
	case name == "list" || name == "set" || name == "vector" || name == "tuple":
		arr, ok := v.([]any)
		if !ok {
			return "", fmt.Errorf("expected an array for %s", name)
		}
		parts := make([]string, len(arr))
		for i, e := range arr {
			et := td.Args[0]
			if name == "tuple" {
				if i >= len(td.Args) {
					return "", fmt.Errorf("tuple has %d elements, got more", len(td.Args))
				}
				et = td.Args[i]
			}
			l, err := JSONLiteral(e, et, snap)
			if err != nil {
				return "", err
			}
			parts[i] = l
		}
		if name == "tuple" && len(arr) != len(td.Args) {
			return "", fmt.Errorf("tuple has %d elements, got %d", len(td.Args), len(arr))
		}
		switch name {
		case "set":
			return "{" + strings.Join(parts, ", ") + "}", nil
		case "tuple":
			return "(" + strings.Join(parts, ", ") + ")", nil
		}
		return "[" + strings.Join(parts, ", ") + "]", nil
	case name == "map":
		m, ok := v.(map[string]any)
		if !ok || len(td.Args) != 2 {
			return "", fmt.Errorf("expected an object for map")
		}
		keys := make([]string, 0, len(m))
		for k := range m {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, k := range keys {
			kl, err := JSONLiteral(k, td.Args[0], snap)
			if err != nil {
				return "", err
			}
			vl, err := JSONLiteral(m[k], td.Args[1], snap)
			if err != nil {
				return "", err
			}
			parts = append(parts, kl+": "+vl)
		}
		return "{" + strings.Join(parts, ", ") + "}", nil
	}
	switch x := v.(type) {
	case json.Number:
		if integerTypes[name] && !intLiteral.MatchString(x.String()) {
			return "", fmt.Errorf("%s is not a valid %s", x, name)
		}
		if name == "boolean" {
			return "", fmt.Errorf("expected true or false for boolean")
		}
		if name == "text" || name == "varchar" || name == "ascii" {
			return cql.QuoteString(x.String()), nil
		}
		return x.String(), nil
	case bool:
		if name != "boolean" {
			return "", fmt.Errorf("expected a %s, got a boolean", name)
		}
		return fmt.Sprintf("%t", x), nil
	case string:
		switch name {
		case "uuid", "timeuuid", "blob", "duration", "decimal", "varint", "bigint", "int", "smallint", "tinyint", "float", "double":
			if integerTypes[name] && !intLiteral.MatchString(x) {
				return "", fmt.Errorf("%q is not a valid %s", x, name)
			}
			if !bareLiteral.MatchString(x) {
				return "", fmt.Errorf("%q is not a valid %s", x, name)
			}
			return x, nil
		}
		return cql.QuoteString(x), nil
	}
	return "", fmt.Errorf("unsupported value %v for type %s", v, name)
}
