package importer

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/0funct0ry/helenus/internal/codec"
)

var timestampFallbacks = []string{
	"2006-01-02 15:04:05.999999999-0700", "2006-01-02 15:04:05.999999999Z07:00", "2006-01-02 15:04:05-0700",
	"2006-01-02 15:04:05.999999999", "2006-01-02 15:04:05", "2006-01-02T15:04:05.999999999", "2006-01-02T15:04",
}

// Convert turns one source value (a CSV string or a decoded JSON value) into the
// driver value for a column of type td. Nil stays nil.
func Convert(v any, td codec.TypeDesc, udt codec.UDTFieldTypes) (any, error) {
	if v == nil {
		return nil, nil
	}
	if s, ok := v.(string); ok {
		return convertText(s, td, udt)
	}
	return decodeAny(normalize(v, td, udt), td, udt)
}

func decodeAny(v any, td codec.TypeDesc, udt codec.UDTFieldTypes) (any, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return codec.Decode(raw, td, udt)
}

func convertText(s string, td codec.TypeDesc, udt codec.UDTFieldTypes) (any, error) {
	switch td.Name {
	case "ascii", "text", "varchar":
		return decodeAny(s, td, udt)
	case "boolean":
		switch strings.ToLower(strings.TrimSpace(s)) {
		case "true", "yes", "1":
			return true, nil
		case "false", "no", "0":
			return false, nil
		}
		return nil, errors.New("boolean: expected true or false")
	case "list", "set", "map", "tuple", "vector":
		return convertLiteral(s, td, udt)
	}
	if td.UDT != nil {
		return convertLiteral(s, td, udt)
	}
	t := strings.TrimSpace(s)
	got, err := decodeAny(t, td, udt)
	if err != nil && td.Name == "timestamp" {
		for _, l := range timestampFallbacks {
			if ts, perr := time.Parse(l, t); perr == nil {
				return decodeAny(ts.UTC().Format(time.RFC3339Nano), td, udt)
			}
		}
		if n, perr := strconv.ParseInt(t, 10, 64); perr == nil {
			return time.UnixMilli(n).UTC(), nil
		}
	}
	return got, err
}

// convertLiteral reads a collection, tuple or UDT cell: JSON first, then a CQL literal.
func convertLiteral(s string, td codec.TypeDesc, udt codec.UDTFieldTypes) (any, error) {
	t := strings.TrimSpace(s)
	if t == "" {
		return nil, nil
	}
	if t[0] == '[' || t[0] == '{' {
		var v any
		dec := json.NewDecoder(strings.NewReader(t))
		dec.UseNumber()
		if dec.Decode(&v) == nil && !dec.More() {
			if got, err := decodeAny(normalize(v, td, udt), td, udt); err == nil {
				return got, nil
			}
		}
	}
	p := &litParser{s: t, udt: udt}
	v, err := p.value(td)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", td.Name, err)
	}
	p.skip()
	if p.i < len(p.s) {
		return nil, fmt.Errorf("%s: unexpected %q after the value", td.Name, p.s[p.i:])
	}
	return decodeAny(v, td, udt)
}

// normalize rewrites JSON objects given for map columns into the codec's
// [key, value] pair form, recursively.
func normalize(v any, td codec.TypeDesc, udt codec.UDTFieldTypes) any {
	switch x := v.(type) {
	case map[string]any:
		if td.Name == "map" && len(td.Args) == 2 {
			pairs := make([]any, 0, len(x))
			for k, val := range x {
				pairs = append(pairs, []any{k, normalize(val, td.Args[1], udt)})
			}
			return pairs
		}
		if td.UDT != nil && udt != nil {
			fields := udt(*td.UDT)
			out := make(map[string]any, len(x))
			for k, val := range x {
				if ft, ok := fields[k]; ok {
					val = normalize(val, ft, udt)
				}
				out[k] = val
			}
			return out
		}
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			switch td.Name {
			case "list", "set", "vector":
				if len(td.Args) > 0 {
					e = normalize(e, td.Args[0], udt)
				}
			case "tuple":
				if i < len(td.Args) {
					e = normalize(e, td.Args[i], udt)
				}
			case "map":
				if pair, ok := e.([]any); ok && len(pair) == 2 && len(td.Args) == 2 {
					e = []any{pair[0], normalize(pair[1], td.Args[1], udt)}
				}
			}
			out[i] = e
		}
		return out
	}
	return v
}

// litParser reads a CQL collection literal into the codec's JSON form.
type litParser struct {
	s   string
	i   int
	udt codec.UDTFieldTypes
}

func (p *litParser) skip() {
	for p.i < len(p.s) && strings.ContainsRune(" \t\r\n", rune(p.s[p.i])) {
		p.i++
	}
}

func (p *litParser) peek() byte {
	p.skip()
	if p.i >= len(p.s) {
		return 0
	}
	return p.s[p.i]
}

func (p *litParser) expect(c byte) error {
	if p.peek() != c {
		return fmt.Errorf("expected %q", string(c))
	}
	p.i++
	return nil
}

// items reads elements up to the closing byte; each calls elem.
func (p *litParser) items(closer byte, elem func() error) error {
	if p.peek() == closer {
		p.i++
		return nil
	}
	for {
		if err := elem(); err != nil {
			return err
		}
		switch p.peek() {
		case ',':
			p.i++
		case closer:
			p.i++
			return nil
		default:
			return fmt.Errorf("expected , or %q", string(closer))
		}
	}
}

func (p *litParser) value(td codec.TypeDesc) (any, error) {
	if p.peek() == 0 {
		return nil, errors.New("unexpected end of the value")
	}
	switch {
	case td.Name == "list" || td.Name == "vector" || td.Name == "set":
		open, closer := byte('['), byte(']')
		if td.Name == "set" && p.peek() == '{' {
			open, closer = '{', '}'
		}
		if err := p.expect(open); err != nil {
			return nil, err
		}
		out := []any{}
		err := p.items(closer, func() error {
			v, err := p.value(td.Args[0])
			out = append(out, v)
			return err
		})
		return out, err
	case td.Name == "tuple":
		if err := p.expect('('); err != nil {
			return nil, err
		}
		out := []any{}
		err := p.items(')', func() error {
			if len(out) >= len(td.Args) {
				return errors.New("too many tuple elements")
			}
			v, err := p.value(td.Args[len(out)])
			out = append(out, v)
			return err
		})
		return out, err
	case td.Name == "map":
		if err := p.expect('{'); err != nil {
			return nil, err
		}
		out := []any{}
		err := p.items('}', func() error {
			k, err := p.value(td.Args[0])
			if err != nil {
				return err
			}
			if err := p.expect(':'); err != nil {
				return err
			}
			v, err := p.value(td.Args[1])
			out = append(out, []any{k, v})
			return err
		})
		return out, err
	case td.UDT != nil:
		if err := p.expect('{'); err != nil {
			return nil, err
		}
		var fields map[string]codec.TypeDesc
		if p.udt != nil {
			fields = p.udt(*td.UDT)
		}
		out := map[string]any{}
		err := p.items('}', func() error {
			name, err := p.word()
			if err != nil {
				return err
			}
			ft, ok := fields[name]
			if !ok {
				return fmt.Errorf("no field %q", name)
			}
			if err := p.expect(':'); err != nil {
				return err
			}
			out[name], err = p.value(ft)
			return err
		})
		return out, err
	}
	return p.scalar(td)
}

func (p *litParser) word() (string, error) {
	p.skip()
	if p.i < len(p.s) && p.s[p.i] == '"' {
		end := strings.IndexByte(p.s[p.i+1:], '"')
		if end < 0 {
			return "", errors.New("unterminated quoted name")
		}
		w := p.s[p.i+1 : p.i+1+end]
		p.i += end + 2
		return w, nil
	}
	start := p.i
	for p.i < len(p.s) && (p.s[p.i] == '_' || p.s[p.i] >= '0' && p.s[p.i] <= '9' || p.s[p.i]|0x20 >= 'a' && p.s[p.i]|0x20 <= 'z') {
		p.i++
	}
	if start == p.i {
		return "", errors.New("expected a field name")
	}
	return strings.ToLower(p.s[start:p.i]), nil
}

func (p *litParser) scalar(td codec.TypeDesc) (any, error) {
	if p.peek() == '\'' {
		var b strings.Builder
		for p.i++; p.i < len(p.s); p.i++ {
			if p.s[p.i] == '\'' {
				if p.i+1 < len(p.s) && p.s[p.i+1] == '\'' {
					b.WriteByte('\'')
					p.i++
					continue
				}
				p.i++
				return b.String(), nil
			}
			b.WriteByte(p.s[p.i])
		}
		return nil, errors.New("unterminated string")
	}
	start := p.i
	for p.i < len(p.s) && !strings.ContainsRune(",]})(: \t\r\n", rune(p.s[p.i])) {
		p.i++
	}
	tok := p.s[start:p.i]
	switch {
	case tok == "":
		return nil, fmt.Errorf("unexpected %q", string(p.s[p.i]))
	case strings.EqualFold(tok, "null"):
		return nil, nil
	case td.Name == "boolean" && strings.EqualFold(tok, "true"):
		return true, nil
	case td.Name == "boolean" && strings.EqualFold(tok, "false"):
		return false, nil
	}
	return tok, nil
}
