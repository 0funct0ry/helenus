package schema

import (
	"strings"
	"testing"
)

func functionSnapshot(version string) *Snapshot {
	f := Function{Keyspace: "shop", Name: "add_tax", ArgNames: []string{"a", "r"}, ArgTypes: []string{"decimal", "decimal"}, ReturnType: "decimal", Language: "java", Body: "return a;"}
	ag := Aggregate{Keyspace: "shop", Name: "total", ArgTypes: []string{"decimal"}, StateFunc: "acc", StateType: "decimal"}
	acc := Function{Keyspace: "shop", Name: "acc", ArgNames: []string{"s", "v"}, ArgTypes: []string{"decimal", "decimal"}, ReturnType: "decimal", Language: "java", Body: "return s;"}
	return &Snapshot{Version: version, Keyspaces: []Keyspace{
		{Name: "shop", Functions: []Function{f, acc}, Aggregates: []Aggregate{ag}, Types: []UDT{{Keyspace: "shop", Name: "addr"}}},
		{Name: "system_x", System: true},
	}}
}

func TestPlanFunction(t *testing.T) {
	dec := []FunctionArg{{"amount", "decimal"}, {"rate", "decimal"}}
	base := func(r FunctionRequest) FunctionRequest {
		if r.Keyspace == "" {
			r.Keyspace = "shop"
		}
		return r
	}
	tests := []struct {
		name    string
		version string
		req     FunctionRequest
		want    string
		err     string
		notes   string
	}{
		{name: "create", req: FunctionRequest{Action: "create", Name: "tax2", Args: dec, Returns: "decimal", Body: "return amount;"},
			want:  "CREATE FUNCTION shop.tax2 (amount decimal, rate decimal)\n  RETURNS NULL ON NULL INPUT\n  RETURNS decimal\n  LANGUAGE java\n  AS $$return amount;$$;",
			notes: "user_defined_functions_enabled"},
		{name: "called on null", req: FunctionRequest{Action: "create", Name: "f", Returns: "int", Body: "return 1;", CalledOnNull: true, IfNotExists: true},
			want: "CREATE FUNCTION IF NOT EXISTS shop.f ()\n  CALLED ON NULL INPUT"},
		{name: "replace", req: FunctionRequest{Action: "replace", Name: "add_tax", Args: dec, Returns: "decimal", Body: "return amount;"}, want: "CREATE OR REPLACE FUNCTION shop.add_tax"},
		{name: "exists", req: FunctionRequest{Action: "create", Name: "add_tax", Args: dec, Returns: "decimal", Body: "x"}, err: "choose Replace"},
		{name: "overload", req: FunctionRequest{Action: "create", Name: "add_tax", Args: []FunctionArg{{"a", "int"}}, Returns: "int", Body: "x"}, want: "shop.add_tax (a int)"},
		{name: "replace missing", req: FunctionRequest{Action: "replace", Name: "nope", Returns: "int", Body: "x"}, err: "cannot be replaced"},
		{name: "replace + if not exists", req: FunctionRequest{Action: "replace", Name: "add_tax", Args: dec, Returns: "decimal", Body: "x", IfNotExists: true}, err: "cannot be combined"},
		{name: "dollars", req: FunctionRequest{Action: "create", Name: "f", Returns: "int", Body: "a $$ b"}, err: "must not contain $$"},
		{name: "empty body", req: FunctionRequest{Action: "create", Name: "f", Returns: "int", Body: " "}, err: "body is required"},
		{name: "dup args", req: FunctionRequest{Action: "create", Name: "f", Args: []FunctionArg{{"a", "int"}, {"a", "int"}}, Returns: "int", Body: "x"}, err: "listed twice"},
		{name: "bad name", req: FunctionRequest{Action: "create", Name: "1f", Returns: "int", Body: "x"}, err: "must start with a letter"},
		{name: "freeze", req: FunctionRequest{Action: "create", Name: "f", Args: []FunctionArg{{"l", "list<int>"}}, Returns: "addr", Body: "x"},
			want: "(l frozen<list<int>>)", notes: "frozen"},
		{name: "udt", req: FunctionRequest{Action: "create", Name: "f", Returns: "ghost", Body: "x"}, err: "not found"},
		{name: "js 4.x", version: "4.1.5", req: FunctionRequest{Action: "create", Name: "f", Returns: "int", Body: "1", Language: "javascript"}, want: "LANGUAGE javascript"},
		{name: "js 5.0", version: "5.0", req: FunctionRequest{Action: "create", Name: "f", Returns: "int", Body: "1", Language: "javascript"}, err: "not supported on Cassandra 5.0"},
		{name: "drop", req: FunctionRequest{Action: "drop", Name: "add_tax", Args: dec}, want: "DROP FUNCTION shop.add_tax(decimal, decimal);"},
		{name: "drop missing", req: FunctionRequest{Action: "drop", Name: "add_tax"}, err: "not found"},
		{name: "drop used by aggregate", req: FunctionRequest{Action: "drop", Name: "acc", Args: []FunctionArg{{"s", "decimal"}, {"v", "decimal"}}}, err: "used by aggregate total"},
		{name: "system", req: FunctionRequest{Action: "create", Keyspace: "system_x", Name: "f"}, err: "system keyspace"},
		{name: "no keyspace", req: FunctionRequest{Action: "create", Keyspace: "zzz"}, err: "not found"},
		{name: "bad action", req: FunctionRequest{Action: "zap"}, err: "Action must be"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			v := tc.version
			if v == "" {
				v = "4.1.5"
			}
			p := PlanFunction(functionSnapshot(v), base(tc.req))
			var msgs []string
			for _, e := range p.Errors {
				msgs = append(msgs, e.Message)
			}
			joined := strings.Join(msgs, "; ")
			if tc.err != "" {
				if !strings.Contains(joined, tc.err) || p.Statement != "" {
					t.Fatalf("errors %q, statement %q; want error %q", joined, p.Statement, tc.err)
				}
				return
			}
			if len(msgs) > 0 || !strings.Contains(p.Statement, tc.want) {
				t.Fatalf("errors %q, statement %q; want %q", joined, p.Statement, tc.want)
			}
			if tc.notes != "" && !strings.Contains(strings.Join(p.Notes, "|"), tc.notes) {
				t.Errorf("notes %q lack %q", p.Notes, tc.notes)
			}
		})
	}
}
