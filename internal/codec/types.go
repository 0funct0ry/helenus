// Package codec describes CQL types and, from M4, encodes values for them.
// M3 provides the type descriptors (SPEC §7.3).
package codec

import (
	"fmt"
	"strconv"
	"strings"
)

// UDTRef names a user-defined type.
type UDTRef struct {
	Keyspace string `json:"keyspace"`
	Name     string `json:"name"`
}

// TypeDesc is the JSON type descriptor attached to columns and fields.
// Collections, tuples and vectors carry their element types in Args; a vector's
// dimension is in Size. A UDT has Name set to the type name and UDT set.
type TypeDesc struct {
	Name   string     `json:"name"`
	Frozen bool       `json:"frozen,omitempty"`
	Args   []TypeDesc `json:"args,omitempty"`
	UDT    *UDTRef    `json:"udt,omitempty"`
	Size   int        `json:"size,omitempty"`
}

var native = map[string]bool{
	"ascii": true, "bigint": true, "blob": true, "boolean": true, "counter": true, "date": true,
	"decimal": true, "double": true, "duration": true, "float": true, "inet": true, "int": true,
	"smallint": true, "text": true, "time": true, "timestamp": true, "timeuuid": true, "tinyint": true,
	"uuid": true, "varchar": true, "varint": true,
}

// IsNative reports whether name is a built-in scalar CQL type.
func IsNative(name string) bool { return native[strings.ToLower(name)] }

// String renders the descriptor as CQL, e.g. frozen<map<text, frozen<address>>>.
// A UDT in the same keyspace as ref is written bare, matching system_schema.
func (t TypeDesc) String() string {
	var s string
	switch {
	case t.Name == "vector":
		s = fmt.Sprintf("vector<%s, %d>", t.Args[0], t.Size)
	case len(t.Args) > 0:
		parts := make([]string, len(t.Args))
		for i, a := range t.Args {
			parts[i] = a.String()
		}
		s = t.Name + "<" + strings.Join(parts, ", ") + ">"
	case t.UDT != nil:
		s = quoteIfNeeded(t.Name)
	default:
		s = t.Name
	}
	if t.Frozen {
		return "frozen<" + s + ">"
	}
	return s
}

func quoteIfNeeded(id string) string {
	for i, r := range id {
		if !(r == '_' || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9' && i > 0)) {
			return `"` + strings.ReplaceAll(id, `"`, `""`) + `"`
		}
	}
	return id
}

// Walk calls fn for t and every nested descriptor.
func (t TypeDesc) Walk(fn func(TypeDesc)) {
	fn(t)
	for _, a := range t.Args {
		a.Walk(fn)
	}
}

// Parse reads a CQL type as stored in system_schema (frozen<…>, nested collections,
// tuples, vector<float, 3>, UDT names). Bare identifiers that are not native types
// become UDT references in keyspace ks.
func Parse(s, ks string) (TypeDesc, error) {
	p := &parser{in: s, ks: ks}
	t, err := p.typ()
	if err != nil {
		return TypeDesc{}, fmt.Errorf("parsing type %q: %w", s, err)
	}
	p.skip()
	if p.pos != len(p.in) {
		return TypeDesc{}, fmt.Errorf("parsing type %q: unexpected %q", s, p.in[p.pos:])
	}
	return t, nil
}

type parser struct {
	in  string
	pos int
	ks  string
}

func (p *parser) skip() {
	for p.pos < len(p.in) && p.in[p.pos] == ' ' {
		p.pos++
	}
}

func (p *parser) eat(c byte) bool {
	p.skip()
	if p.pos < len(p.in) && p.in[p.pos] == c {
		p.pos++
		return true
	}
	return false
}

func (p *parser) ident() (string, bool, error) {
	p.skip()
	if p.pos < len(p.in) && p.in[p.pos] == '"' {
		p.pos++
		var b strings.Builder
		for p.pos < len(p.in) {
			c := p.in[p.pos]
			p.pos++
			if c == '"' {
				if p.pos < len(p.in) && p.in[p.pos] == '"' {
					b.WriteByte('"')
					p.pos++
					continue
				}
				return b.String(), true, nil
			}
			b.WriteByte(c)
		}
		return "", false, fmt.Errorf("unterminated quoted identifier")
	}
	start := p.pos
	for p.pos < len(p.in) {
		c := p.in[p.pos]
		if c == '_' || c == '.' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
			p.pos++
			continue
		}
		break
	}
	if start == p.pos {
		return "", false, fmt.Errorf("expected a type name at offset %d", start)
	}
	return p.in[start:p.pos], false, nil
}

func (p *parser) args() ([]TypeDesc, error) {
	var out []TypeDesc
	if !p.eat('<') {
		return nil, fmt.Errorf("expected '<'")
	}
	for {
		t, err := p.typ()
		if err != nil {
			return nil, err
		}
		out = append(out, t)
		if p.eat(',') {
			continue
		}
		if p.eat('>') {
			return out, nil
		}
		return nil, fmt.Errorf("expected ',' or '>' at offset %d", p.pos)
	}
}

func (p *parser) typ() (TypeDesc, error) {
	name, quoted, err := p.ident()
	if err != nil {
		return TypeDesc{}, err
	}
	lower := strings.ToLower(name)
	if quoted {
		return TypeDesc{Name: name, UDT: &UDTRef{Keyspace: p.ks, Name: name}}, nil
	}
	switch lower {
	case "frozen":
		args, err := p.args()
		if err != nil || len(args) != 1 {
			return TypeDesc{}, fmt.Errorf("frozen takes one type")
		}
		args[0].Frozen = true
		return args[0], nil
	case "list", "set", "map", "tuple":
		args, err := p.args()
		if err != nil {
			return TypeDesc{}, err
		}
		return TypeDesc{Name: lower, Args: args}, nil
	case "vector":
		if !p.eat('<') {
			return TypeDesc{}, fmt.Errorf("expected '<'")
		}
		elem, err := p.typ()
		if err != nil {
			return TypeDesc{}, err
		}
		if !p.eat(',') {
			return TypeDesc{}, fmt.Errorf("vector needs a dimension")
		}
		p.skip()
		start := p.pos
		for p.pos < len(p.in) && p.in[p.pos] >= '0' && p.in[p.pos] <= '9' {
			p.pos++
		}
		n, err := strconv.Atoi(p.in[start:p.pos])
		if err != nil || !p.eat('>') {
			return TypeDesc{}, fmt.Errorf("bad vector dimension")
		}
		return TypeDesc{Name: "vector", Args: []TypeDesc{elem}, Size: n}, nil
	}
	if native[lower] {
		return TypeDesc{Name: lower}, nil
	}
	ks, n := p.ks, name
	if i := strings.IndexByte(name, '.'); i > 0 {
		ks, n = name[:i], name[i+1:]
	}
	return TypeDesc{Name: n, UDT: &UDTRef{Keyspace: ks, Name: n}}, nil
}
