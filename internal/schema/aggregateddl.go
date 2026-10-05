package schema

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/0funct0ry/helenus/internal/codec"
)

// Actions accepted by PlanAggregate (SPEC §9.21).
const (
	AggregateCreate  = "create"
	AggregateReplace = "replace"
	AggregateDrop    = "drop"
)

// AggregateRequest describes an aggregate to create or replace, or (Name and ArgTypes only) to drop.
// InitCond is a JSON value rendered as a CQL literal of SType; empty or null means no INITCOND.
type AggregateRequest struct {
	Action      string          `json:"action"`
	Keyspace    string          `json:"keyspace"`
	Name        string          `json:"name"`
	ArgTypes    []string        `json:"arg_types"`
	SFunc       string          `json:"sfunc"`
	SType       string          `json:"stype"`
	FinalFunc   string          `json:"finalfunc"`
	InitCond    json.RawMessage `json:"initcond"`
	IfNotExists bool            `json:"if_not_exists"`
}

// AggregatePlan is the planned statement, its blocking errors and its notes.
type AggregatePlan = KeyspacePlan

// AggregateCandidate is a function offered for the SFUNC or FINALFUNC slot; when OK is false Reason says
// which signature the slot needs.
type AggregateCandidate struct {
	Name      string `json:"name"`
	Signature string `json:"signature"`
	Returns   string `json:"returns"`
	OK        bool   `json:"ok"`
	Reason    string `json:"reason,omitempty"`
}

// sameType compares two CQL types ignoring frozen wrappers and spacing.
func sameType(ks, a, b string) bool {
	return typeKey(ks, a) == typeKey(ks, b)
}

// SameType compares two CQL types ignoring frozen wrappers and spacing.
func SameType(ks, a, b string) bool { return sameType(ks, a, b) }

func typeKey(ks, s string) string {
	return strings.ReplaceAll(stripFrozen(displayType(ks, s)), " ", "")
}

// stripFrozen removes every frozen<...> wrapper, keeping the wrapped type.
func stripFrozen(s string) string {
	for {
		i := strings.Index(s, "frozen<")
		if i < 0 {
			return s
		}
		depth, j := 0, i+len("frozen")
		for ; j < len(s); j++ {
			if s[j] == '<' {
				depth++
			} else if s[j] == '>' {
				depth--
				if depth == 0 {
					break
				}
			}
		}
		if j >= len(s) {
			return s
		}
		s = s[:i] + s[i+len("frozen<"):j] + s[j+1:]
	}
}

// displayType renders a CQL type the way the statement shows it: normalized, and without the frozen
// wrapper on a top-level tuple (tuples are implicitly frozen).
func displayType(ks, s string) string {
	if t, err := codec.Parse(s, ks); err == nil {
		s = t.String()
	}
	if strings.HasPrefix(s, "frozen<tuple<") && strings.HasSuffix(s, ">>") {
		return s[len("frozen<") : len(s)-1]
	}
	return s
}

// needs renders the signature a slot requires, e.g. "(tuple<int, bigint>, int) → tuple<int, bigint>".
func needs(args []string, ret string) string {
	return "Needs (" + strings.Join(args, ", ") + ") → " + ret
}

// matchesSignature reports whether f takes exactly args and returns ret.
func matchesSignature(ks string, f Function, args []string, ret string) bool {
	if len(f.ArgTypes) != len(args) || !sameType(ks, f.ReturnType, ret) {
		return false
	}
	for i, a := range f.ArgTypes {
		if !sameType(ks, a, args[i]) {
			return false
		}
	}
	return true
}

func findAggregate(ks *Keyspace, name string, argTypes []string) *Aggregate {
	for i, a := range ks.Aggregates {
		if a.Name != name || len(a.ArgTypes) != len(argTypes) {
			continue
		}
		same := true
		for j, t := range a.ArgTypes {
			if !sameType(ks.Name, t, argTypes[j]) {
				same = false
				break
			}
		}
		if same {
			return &ks.Aggregates[i]
		}
	}
	return nil
}

// AggregateCandidates lists every function in the keyspace for the SFUNC slot (final=false) or the
// FINALFUNC slot (final=true) of an aggregate over argTypes with state type stype. FINALFUNC may
// return any type, so only its argument is checked.
func AggregateCandidates(s *Snapshot, keyspace string, argTypes []string, stype string, final bool) []AggregateCandidate {
	out := []AggregateCandidate{}
	var ks *Keyspace
	if s != nil {
		ks = s.Keyspace(keyspace)
	}
	if ks == nil || strings.TrimSpace(stype) == "" {
		return out
	}
	stype = displayType(ks.Name, stype)
	want := append([]string{stype}, argTypes...)
	reason := needs(want, stype)
	if final {
		want = []string{stype}
		reason = "Needs (" + stype + ") → any type"
	}
	for _, f := range ks.Functions {
		ok := false
		if final {
			ok = len(f.ArgTypes) == 1 && sameType(ks.Name, f.ArgTypes[0], stype)
		} else {
			ok = matchesSignature(ks.Name, f, want, stype)
		}
		c := AggregateCandidate{Name: f.Name, Signature: f.Signature(), Returns: f.ReturnType, OK: ok}
		if !ok {
			c.Reason = reason
		}
		out = append(out, c)
	}
	return out
}

// PlanAggregate validates req against the snapshot and renders CREATE [OR REPLACE] AGGREGATE or DROP AGGREGATE.
func PlanAggregate(s *Snapshot, req AggregateRequest) AggregatePlan {
	p := AggregatePlan{Errors: []PlanError{}, Notes: []string{}}
	fail := func(field, msg string) { p.Errors = append(p.Errors, PlanError{Field: field, Message: msg}) }
	note := func(msg string) { p.Notes = append(p.Notes, msg) }

	var ks *Keyspace
	if s != nil {
		ks = s.Keyspace(req.Keyspace)
	}
	if ks == nil {
		fail("keyspace", fmt.Sprintf("Keyspace %s not found", req.Keyspace))
		return p
	}
	if ks.System {
		fail("keyspace", fmt.Sprintf("%s is a system keyspace; its aggregates cannot be changed", ks.Name))
		return p
	}
	if req.Action != AggregateCreate && req.Action != AggregateReplace && req.Action != AggregateDrop {
		fail("action", fmt.Sprintf("Action must be create, replace or drop, not %q", req.Action))
		return p
	}
	if !keyspaceNameRe.MatchString(req.Name) || len(req.Name) > maxKeyspaceNameLen {
		fail("name", fmt.Sprintf("Aggregate name must start with a letter, use only letters, digits and underscores, and be at most %d characters", maxKeyspaceNameLen))
	}

	argTypes := make([]string, len(req.ArgTypes))
	for i, a := range req.ArgTypes {
		field := fmt.Sprintf("arg_types.%d", i)
		t, changed, ok := functionType(ks, field, a, fail)
		if !ok {
			continue
		}
		if changed && req.Action != AggregateDrop {
			note(fmt.Sprintf("Argument %d is frozen because aggregate arguments cannot be non-frozen collections, tuples or types.", i+1))
		}
		argTypes[i] = displayType(ks.Name, t.String())
	}
	if len(p.Errors) > 0 {
		return p
	}
	existing := findAggregate(ks, req.Name, argTypes)

	if req.Action == AggregateDrop {
		if existing == nil {
			fail("name", fmt.Sprintf("Aggregate %s(%s) not found", req.Name, strings.Join(argTypes, ", ")))
		} else {
			p.Statement = "DROP AGGREGATE " + qname(ks.Name, req.Name) + "(" + strings.Join(argTypes, ", ") + ");"
		}
		return p
	}

	st, changed, stOK := functionType(ks, "stype", req.SType, fail)
	stype := displayType(ks.Name, st.String())
	if stOK && changed {
		note("The state type is frozen because aggregate state cannot be a non-frozen collection, tuple or type.")
	}

	var sf *Function
	if stOK {
		want := append([]string{stype}, argTypes...)
		sf = pickFunction(ks, req.SFunc, func(f Function) bool { return matchesSignature(ks.Name, f, want, stype) })
		switch {
		case strings.TrimSpace(req.SFunc) == "":
			fail("sfunc", "State function is required")
		case sf == nil && !hasFunctionNamed(ks, req.SFunc):
			fail("sfunc", fmt.Sprintf("Function %s not found in %s. %s", req.SFunc, ks.Name, needs(want, stype)))
		case sf == nil:
			fail("sfunc", fmt.Sprintf("Function %s has no overload with this signature. %s", req.SFunc, needs(want, stype)))
		}
	}

	if req.FinalFunc != "" && stOK {
		ff := pickFunction(ks, req.FinalFunc, func(f Function) bool {
			return len(f.ArgTypes) == 1 && sameType(ks.Name, f.ArgTypes[0], stype)
		})
		switch {
		case ff == nil && !hasFunctionNamed(ks, req.FinalFunc):
			fail("finalfunc", fmt.Sprintf("Function %s not found in %s. Needs (%s)", req.FinalFunc, ks.Name, stype))
		case ff == nil:
			fail("finalfunc", fmt.Sprintf("Function %s has no overload taking (%s)", req.FinalFunc, stype))
		}
	}

	initLit := ""
	trimmed := bytes.TrimSpace(req.InitCond)
	if len(trimmed) > 0 && string(trimmed) != "null" && stOK {
		dec := json.NewDecoder(bytes.NewReader(trimmed))
		dec.UseNumber()
		var v any
		if err := dec.Decode(&v); err != nil {
			fail("initcond", "INITCOND is not valid JSON: "+err.Error())
		} else if lit, err := JSONLiteral(v, st, s); err != nil {
			fail("initcond", fmt.Sprintf("INITCOND does not match state type %s: %v", stype, err))
		} else {
			initLit = lit
		}
	} else if sf != nil && !sf.CalledOnNull {
		note("With no INITCOND the state starts as null and this function will never run")
	}

	if req.Action == AggregateReplace && req.IfNotExists {
		fail("if_not_exists", "OR REPLACE and IF NOT EXISTS cannot be combined")
	}
	if req.Action == AggregateCreate && existing != nil && !req.IfNotExists {
		fail("name", "An aggregate with this signature exists; choose Replace")
	}
	if req.Action == AggregateReplace && existing == nil {
		fail("name", fmt.Sprintf("Aggregate %s(%s) not found, so it cannot be replaced", req.Name, strings.Join(argTypes, ", ")))
	}
	if len(p.Errors) > 0 {
		return p
	}

	var b strings.Builder
	b.WriteString("CREATE ")
	if req.Action == AggregateReplace {
		b.WriteString("OR REPLACE ")
	}
	b.WriteString("AGGREGATE ")
	if req.IfNotExists {
		b.WriteString("IF NOT EXISTS ")
	}
	b.WriteString(qname(ks.Name, req.Name) + " (" + strings.Join(argTypes, ", ") + ")\n")
	b.WriteString("  SFUNC " + Ident(req.SFunc) + "\n  STYPE " + stype)
	if req.FinalFunc != "" {
		b.WriteString("\n  FINALFUNC " + Ident(req.FinalFunc))
	}
	if initLit != "" {
		b.WriteString("\n  INITCOND " + initLit)
	}
	b.WriteString(";")
	p.Statement = b.String()
	note("Aggregates use user-defined functions, which require `user_defined_functions_enabled: true` in cassandra.yaml")
	return p
}

func hasFunctionNamed(ks *Keyspace, name string) bool {
	for _, f := range ks.Functions {
		if f.Name == name {
			return true
		}
	}
	return false
}

func pickFunction(ks *Keyspace, name string, ok func(Function) bool) *Function {
	for i, f := range ks.Functions {
		if f.Name == name && ok(f) {
			return &ks.Functions[i]
		}
	}
	return nil
}
