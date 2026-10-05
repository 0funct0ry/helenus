package schema

import (
	"fmt"
	"strings"
	"unicode"

	"github.com/0funct0ry/helenus/internal/codec"
)

// Type management actions (SPEC §9.11).
const (
	TypeCreate      = "create"
	TypeAddField    = "add_field"
	TypeRenameField = "rename_field"
	TypeDrop        = "drop"
)

// maxTypeNameLen is Cassandra's limit for schema object names.
const maxTypeNameLen = 48

// FieldSpec is one UDT field in a create or add-field request.
type FieldSpec struct {
	Name string         `json:"name"`
	Type codec.TypeDesc `json:"type"`
}

// TypeRequest describes one UDT DDL action. Create uses Fields, add_field uses Field,
// rename_field uses From and To; drop needs only Keyspace and Name.
type TypeRequest struct {
	Action   string      `json:"action"`
	Keyspace string      `json:"keyspace"`
	Name     string      `json:"name"`
	Fields   []FieldSpec `json:"fields,omitempty"`
	Field    *FieldSpec  `json:"field,omitempty"`
	From     string      `json:"from,omitempty"`
	To       string      `json:"to,omitempty"`
}

// TypePlan is the result of planning a UDT DDL action: the statement (empty when the request is
// malformed), the validation errors that stop it from running, notes about adjustments the builder
// made (such as adding frozen<>), and the objects that use the type.
type TypePlan struct {
	Statement  string   `json:"statement"`
	Errors     []string `json:"errors"`
	Notes      []string `json:"notes"`
	Dependents []string `json:"dependents"`
	// Explain is a plain-language description of what the statement does (M9.14).
	Explain []string `json:"explain"`
}

// PlanType validates req against the snapshot and renders the CQL for it.
func PlanType(s *Snapshot, req TypeRequest) TypePlan {
	p := TypePlan{Errors: []string{}, Notes: []string{}, Dependents: []string{}}
	fail := func(f string, a ...any) { p.Errors = append(p.Errors, fmt.Sprintf(f, a...)) }

	ks := s.Keyspace(req.Keyspace)
	switch {
	case req.Keyspace == "":
		fail("keyspace is required")
		return p
	case ks == nil:
		fail("keyspace %s not found", req.Keyspace)
		return p
	case ks.System:
		fail("%s is a system keyspace; its types cannot be changed", ks.Name)
		return p
	}
	if msg := checkIdent("type name", req.Name); msg != "" {
		fail("%s", msg)
	}
	udt := ks.Type(req.Name)
	if udt != nil {
		p.Dependents = append(p.Dependents, udt.UsedBy...)
	}
	target := qname(req.Keyspace, req.Name)

	switch req.Action {
	case TypeCreate:
		if udt != nil {
			fail("type %s.%s already exists", ks.Name, req.Name)
		}
		if len(req.Fields) == 0 {
			fail("a type needs at least one field")
		}
		lines := make([]string, 0, len(req.Fields))
		seen := map[string]bool{}
		for _, f := range req.Fields {
			cql, ok := p.field(s, ks, req.Name, f, seen)
			if ok {
				lines = append(lines, "    "+cql)
			}
		}
		if len(p.Errors) == 0 {
			p.Statement = fmt.Sprintf("CREATE TYPE %s (\n%s\n);", target, strings.Join(lines, ",\n"))
		}
	case TypeAddField:
		if udt == nil {
			fail("type %s.%s not found", ks.Name, req.Name)
			break
		}
		if req.Field == nil {
			fail("a field is required")
			break
		}
		seen := map[string]bool{}
		for _, f := range udt.Fields {
			seen[f.Name] = true
		}
		if cql, ok := p.field(s, ks, req.Name, *req.Field, seen); ok {
			if reaches(s, ks, req.Field.Type, req.Name) {
				fail("field type would make %s depend on itself", req.Name)
			} else {
				p.Statement = fmt.Sprintf("ALTER TYPE %s ADD %s;", target, cql)
			}
		}
	case TypeRenameField:
		if udt == nil {
			fail("type %s.%s not found", ks.Name, req.Name)
			break
		}
		has := func(n string) bool {
			for _, f := range udt.Fields {
				if f.Name == n {
					return true
				}
			}
			return false
		}
		if !has(req.From) {
			fail("type %s has no field %s", req.Name, req.From)
		}
		if msg := checkIdent("new field name", req.To); msg != "" {
			fail("%s", msg)
		} else if req.To == req.From {
			fail("the new name is the same as the old one")
		} else if has(req.To) {
			fail("type %s already has a field %s", req.Name, req.To)
		}
		if len(p.Errors) == 0 {
			p.Statement = fmt.Sprintf("ALTER TYPE %s RENAME %s TO %s;", target, Ident(req.From), Ident(req.To))
		}
	case TypeDrop:
		if udt == nil {
			fail("type %s.%s not found", ks.Name, req.Name)
			break
		}
		if len(udt.UsedBy) > 0 {
			fail("type %s is used by %s", req.Name, strings.Join(udt.UsedBy, ", "))
		}
		p.Statement = fmt.Sprintf("DROP TYPE %s;", target)
	default:
		fail("unknown action %q", req.Action)
	}
	if len(p.Errors) > 0 {
		p.Statement = ""
	}
	return p
}

// field validates one field and renders `name type`, adding frozen<> where Cassandra requires it.
func (p *TypePlan) field(s *Snapshot, ks *Keyspace, self string, f FieldSpec, seen map[string]bool) (string, bool) {
	n := len(p.Errors)
	if msg := checkIdent("field name", f.Name); msg != "" {
		p.Errors = append(p.Errors, msg)
	} else if seen[f.Name] {
		p.Errors = append(p.Errors, fmt.Sprintf("field %s is listed twice", f.Name))
	}
	seen[f.Name] = true
	p.checkType(s, ks, self, f.Name, f.Type, false)
	if len(p.Errors) > n {
		return "", false
	}
	t, changed := freezeNested(f.Type)
	if changed {
		p.Notes = append(p.Notes, fmt.Sprintf("Field %s is frozen because a type field cannot hold a non-frozen collection, tuple or type.", f.Name))
	}
	return Ident(f.Name) + " " + t.String(), true
}

// checkIdent rejects empty, over-long and control-character names.
func checkIdent(what, id string) string {
	switch {
	case id == "":
		return what + " is required"
	case len(id) > maxTypeNameLen:
		return fmt.Sprintf("%s %q is longer than %d characters", what, id, maxTypeNameLen)
	}
	for _, r := range id {
		if unicode.IsControl(r) {
			return what + " contains a control character"
		}
	}
	return ""
}

var counterErr = "a counter cannot be used inside a type"

// checkType validates a field type against the snapshot. Inside a collection, tuple or vector the
// element types must not be counters; UDT references must name a type in the same keyspace.
func (p *TypePlan) checkType(s *Snapshot, ks *Keyspace, self, field string, t codec.TypeDesc, nested bool) {
	bad := func(f string, a ...any) {
		p.Errors = append(p.Errors, fmt.Sprintf("field %s: ", field)+fmt.Sprintf(f, a...))
	}
	name := strings.ToLower(t.Name)
	switch {
	case t.UDT != nil:
		switch {
		case t.UDT.Keyspace != ks.Name:
			bad("type %s.%s is in another keyspace; a type can only use types from %s", t.UDT.Keyspace, t.UDT.Name, ks.Name)
		case t.UDT.Name == self:
			bad("a type cannot contain itself")
		case ks.Type(t.UDT.Name) == nil:
			bad("type %s not found in %s", t.UDT.Name, ks.Name)
		}
	case name == "list" || name == "set":
		if len(t.Args) != 1 {
			bad("%s takes one element type", name)
			return
		}
	case name == "map":
		if len(t.Args) != 2 {
			bad("map takes a key type and a value type")
			return
		}
	case name == "tuple":
		if len(t.Args) == 0 {
			bad("tuple needs at least one element type")
			return
		}
	case name == "vector":
		if len(t.Args) != 1 || t.Size < 1 {
			bad("vector needs an element type and a dimension of at least 1")
			return
		}
	case codec.IsNative(name):
		if name == "counter" {
			bad("%s", counterErr)
		}
	default:
		bad("unknown type %q", t.Name)
	}
	for _, a := range t.Args {
		p.checkType(s, ks, self, field, a, true)
	}
}

// freezeNested freezes a top-level collection, tuple or UDT that is not frozen yet. Everything
// inside a frozen type is frozen with it, so nothing deeper needs changing.
func freezeNested(t codec.TypeDesc) (codec.TypeDesc, bool) {
	if t.Frozen || t.Name == "vector" || (t.UDT == nil && codec.IsNative(t.Name)) {
		return t, false
	}
	t.Frozen = true
	return t, true
}

// reaches reports whether t refers, directly or through other types, to the type named target.
func reaches(s *Snapshot, ks *Keyspace, t codec.TypeDesc, target string) bool {
	found := false
	seen := map[string]bool{}
	var visit func(codec.TypeDesc)
	visit = func(d codec.TypeDesc) {
		d.Walk(func(x codec.TypeDesc) {
			if x.UDT == nil || found || seen[x.UDT.Keyspace+"."+x.UDT.Name] {
				return
			}
			seen[x.UDT.Keyspace+"."+x.UDT.Name] = true
			if x.UDT.Keyspace == ks.Name && x.UDT.Name == target {
				found = true
				return
			}
			for _, f := range s.UDTFields(*x.UDT) {
				visit(f)
			}
		})
	}
	visit(t)
	return found
}
