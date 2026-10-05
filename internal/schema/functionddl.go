package schema

import (
	"fmt"
	"strings"

	"github.com/0funct0ry/helenus/internal/codec"
)

// Actions and languages accepted by PlanFunction (SPEC §9.20).
const (
	FunctionCreate  = "create"
	FunctionReplace = "replace"
	FunctionDrop    = "drop"

	FunctionJava       = "java"
	FunctionJavaScript = "javascript"
)

// FunctionArg is one named, typed argument; Type is a CQL type string.
type FunctionArg struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// FunctionRequest describes a function to create or replace, or (Name and arg types only) to drop.
type FunctionRequest struct {
	Action       string        `json:"action"`
	Keyspace     string        `json:"keyspace"`
	Name         string        `json:"name"`
	Args         []FunctionArg `json:"args"`
	Returns      string        `json:"returns"`
	CalledOnNull bool          `json:"called_on_null"`
	Language     string        `json:"language"`
	Body         string        `json:"body"`
	IfNotExists  bool          `json:"if_not_exists"`
}

// FunctionPlan is the planned statement, its blocking errors and its notes.
type FunctionPlan = KeyspacePlan

// functionType parses and validates a CQL type for a function argument or return value, freezing
// collections, tuples and UDTs. It returns the rendered type and whether freezing changed it.
func functionType(ks *Keyspace, field, cql string, fail func(string, string)) (codec.TypeDesc, bool, bool) {
	if strings.TrimSpace(cql) == "" {
		fail(field, "Type is required")
		return codec.TypeDesc{}, false, false
	}
	t, err := codec.Parse(cql, ks.Name)
	if err != nil {
		fail(field, err.Error())
		return t, false, false
	}
	var tp TypePlan
	tp.checkType(nil, ks, "", field, t, false)
	if len(tp.Errors) > 0 {
		for _, e := range tp.Errors {
			fail(field, strings.TrimPrefix(e, "field "+field+": "))
		}
		return t, false, false
	}
	t, changed := freezeNested(t)
	return t, changed, true
}

// findFunction returns the function in ks with the given name and rendered argument types.
func findFunction(ks *Keyspace, name string, types []string) *Function {
	for i, f := range ks.Functions {
		if f.Name != name || len(f.ArgTypes) != len(types) {
			continue
		}
		same := true
		for j, a := range f.ArgTypes {
			t, err := codec.Parse(a, ks.Name)
			if err != nil || t.String() != types[j] {
				same = false
				break
			}
		}
		if same {
			return &ks.Functions[i]
		}
	}
	return nil
}

// PlanFunction validates req against the snapshot and renders CREATE [OR REPLACE] FUNCTION or DROP FUNCTION.
func PlanFunction(s *Snapshot, req FunctionRequest) FunctionPlan {
	p := FunctionPlan{Errors: []PlanError{}, Notes: []string{}}
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
		fail("keyspace", fmt.Sprintf("%s is a system keyspace; its functions cannot be changed", ks.Name))
		return p
	}
	if req.Action != FunctionCreate && req.Action != FunctionReplace && req.Action != FunctionDrop {
		fail("action", fmt.Sprintf("Action must be create, replace or drop, not %q", req.Action))
		return p
	}

	if !keyspaceNameRe.MatchString(req.Name) || len(req.Name) > maxKeyspaceNameLen {
		fail("name", fmt.Sprintf("Function name must start with a letter, use only letters, digits and underscores, and be at most %d characters", maxKeyspaceNameLen))
	}

	seen := map[string]bool{}
	argTypes := make([]string, len(req.Args))
	decls := make([]string, len(req.Args))
	for i, a := range req.Args {
		field := fmt.Sprintf("args.%d", i)
		if req.Action != FunctionDrop {
			if !keyspaceNameRe.MatchString(a.Name) || len(a.Name) > maxKeyspaceNameLen {
				fail(field+".name", "Argument name must start with a letter and use only letters, digits and underscores")
			} else if seen[a.Name] {
				fail(field+".name", fmt.Sprintf("Argument %s is listed twice", a.Name))
			}
			seen[a.Name] = true
		}
		t, changed, ok := functionType(ks, field+".type", a.Type, fail)
		if !ok {
			continue
		}
		if changed && req.Action != FunctionDrop {
			note(fmt.Sprintf("Argument %s is frozen because function arguments cannot be non-frozen collections, tuples or types.", a.Name))
		}
		argTypes[i] = t.String()
		decls[i] = Ident(a.Name) + " " + t.String()
	}

	if len(p.Errors) > 0 {
		return p
	}
	existing := findFunction(ks, req.Name, argTypes)

	if req.Action == FunctionDrop {
		if existing == nil {
			fail("name", fmt.Sprintf("Function %s(%s) not found", req.Name, strings.Join(argTypes, ", ")))
		}
		for _, ag := range ks.Aggregates {
			if existing != nil && aggUsesFunction(ag, existing) {
				fail("name", fmt.Sprintf("Function %s is used by aggregate %s", existing.Signature(), ag.Name))
			}
		}
		if len(p.Errors) == 0 {
			p.Statement = "DROP FUNCTION " + qname(ks.Name, req.Name) + "(" + strings.Join(argTypes, ", ") + ");"
		}
		return p
	}

	ret, changed, ok := functionType(ks, "returns", req.Returns, fail)
	if ok && changed {
		note("The return type is frozen because function results cannot be non-frozen collections, tuples or types.")
	}

	lang := strings.ToLower(req.Language)
	if lang == "" {
		lang = FunctionJava
	}
	major := MajorVersion(s.Version)
	switch {
	case lang == FunctionJava:
	case lang == FunctionJavaScript && major >= 5:
		fail("language", "JavaScript functions are not supported on Cassandra 5.0 or later; use java")
	case lang == FunctionJavaScript:
	default:
		fail("language", "Language must be java or javascript")
	}

	switch {
	case strings.TrimSpace(req.Body) == "":
		fail("body", "Function body is required")
	case strings.Contains(req.Body, "$$"):
		fail("body", "The body must not contain $$, which delimits it in the statement")
	}

	if req.Action == FunctionReplace && req.IfNotExists {
		fail("if_not_exists", "OR REPLACE and IF NOT EXISTS cannot be combined")
	}
	if req.Action == FunctionCreate && existing != nil && !req.IfNotExists {
		fail("name", "A function with this signature exists; choose Replace")
	}
	if req.Action == FunctionReplace && existing == nil {
		fail("name", fmt.Sprintf("Function %s(%s) not found, so it cannot be replaced", req.Name, strings.Join(argTypes, ", ")))
	}
	if len(p.Errors) > 0 {
		return p
	}

	var b strings.Builder
	b.WriteString("CREATE ")
	if req.Action == FunctionReplace {
		b.WriteString("OR REPLACE ")
	}
	b.WriteString("FUNCTION ")
	if req.IfNotExists {
		b.WriteString("IF NOT EXISTS ")
	}
	b.WriteString(qname(ks.Name, req.Name) + " (" + strings.Join(decls, ", ") + ")\n")
	if req.CalledOnNull {
		b.WriteString("  CALLED ON NULL INPUT\n")
	} else {
		b.WriteString("  RETURNS NULL ON NULL INPUT\n")
	}
	b.WriteString("  RETURNS " + ret.String() + "\n  LANGUAGE " + lang + "\n  AS $$" + req.Body + "$$;")
	p.Statement = b.String()
	note("UDFs require `user_defined_functions_enabled: true` in cassandra.yaml")
	return p
}

// aggUsesFunction reports whether ag's state or final function is f (matched by name and arity;
// the state function takes the state type plus the aggregate's arguments, the final function the state).
func aggUsesFunction(ag Aggregate, f *Function) bool {
	if ag.StateFunc == f.Name && len(f.ArgTypes) == len(ag.ArgTypes)+1 {
		return true
	}
	return ag.FinalFunc == f.Name && len(f.ArgTypes) == 1
}
