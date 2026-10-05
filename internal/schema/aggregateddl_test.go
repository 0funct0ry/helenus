package schema

import (
	"strings"
	"testing"
)

func aggregateSnapshot() *Snapshot {
	fn := func(name string, args []string, ret string, onNull bool) Function {
		return Function{Keyspace: "shop", Name: name, ArgTypes: args, ReturnType: ret, Language: "java", Body: "x", CalledOnNull: onNull}
	}
	tup := "tuple<int, bigint>"
	return &Snapshot{Version: "4.1.5", Keyspaces: []Keyspace{
		{Name: "shop",
			Functions: []Function{
				fn("state_avg", []string{tup, "int"}, tup, true),
				fn("state_strict", []string{tup, "int"}, tup, false),
				fn("final_avg", []string{tup}, "double", true),
				fn("wrong_ret", []string{tup, "int"}, "int", true),
				fn("wrong_arg", []string{"int", "int"}, tup, true),
			},
			Aggregates: []Aggregate{{Keyspace: "shop", Name: "average", ArgTypes: []string{"int"}, StateFunc: "state_avg", StateType: tup, FinalFunc: "final_avg"}},
		},
		{Name: "system_x", System: true},
	}}
}

func TestPlanAggregate(t *testing.T) {
	tup := "tuple<int, bigint>"
	req := func(r AggregateRequest) AggregateRequest {
		if r.Keyspace == "" {
			r.Keyspace = "shop"
		}
		return r
	}
	tests := []struct {
		name  string
		req   AggregateRequest
		want  string
		err   string
		field string
		notes string
	}{
		{name: "create", req: AggregateRequest{Action: "create", Name: "avg2", ArgTypes: []string{"int"}, SFunc: "state_avg", SType: tup, FinalFunc: "final_avg", InitCond: []byte(`[0, 0]`)},
			want: "CREATE AGGREGATE shop.avg2 (int)\n  SFUNC state_avg\n  STYPE tuple<int, bigint>\n  FINALFUNC final_avg\n  INITCOND (0, 0);", notes: "user_defined_functions_enabled"},
		{name: "no final no init", req: AggregateRequest{Action: "create", Name: "avg2", ArgTypes: []string{"int"}, SFunc: "state_avg", SType: tup, IfNotExists: true},
			want: "CREATE AGGREGATE IF NOT EXISTS shop.avg2 (int)\n  SFUNC state_avg\n  STYPE tuple<int, bigint>;"},
		{name: "replace", req: AggregateRequest{Action: "replace", Name: "average", ArgTypes: []string{"int"}, SFunc: "state_avg", SType: tup, InitCond: []byte(`[0,0]`)},
			want: "CREATE OR REPLACE AGGREGATE shop.average (int)"},
		{name: "strict note", req: AggregateRequest{Action: "create", Name: "a", ArgTypes: []string{"int"}, SFunc: "state_strict", SType: tup},
			want: "SFUNC state_strict", notes: "will never run"},
		{name: "drop", req: AggregateRequest{Action: "drop", Name: "average", ArgTypes: []string{"int"}}, want: "DROP AGGREGATE shop.average(int);"},
		{name: "drop missing", req: AggregateRequest{Action: "drop", Name: "nope", ArgTypes: []string{"int"}}, err: "not found", field: "name"},
		{name: "exists", req: AggregateRequest{Action: "create", Name: "average", ArgTypes: []string{"int"}, SFunc: "state_avg", SType: tup}, err: "choose Replace", field: "name"},
		{name: "replace missing", req: AggregateRequest{Action: "replace", Name: "zzz", ArgTypes: []string{"int"}, SFunc: "state_avg", SType: tup}, err: "cannot be replaced", field: "name"},
		{name: "replace+ine", req: AggregateRequest{Action: "replace", Name: "average", ArgTypes: []string{"int"}, SFunc: "state_avg", SType: tup, IfNotExists: true}, err: "cannot be combined", field: "if_not_exists"},
		{name: "sfunc missing", req: AggregateRequest{Action: "create", Name: "a", ArgTypes: []string{"int"}, SFunc: "ghost", SType: tup}, err: "Function ghost not found", field: "sfunc"},
		{name: "sfunc wrong return", req: AggregateRequest{Action: "create", Name: "a", ArgTypes: []string{"int"}, SFunc: "wrong_ret", SType: tup}, err: "Needs (tuple<int, bigint>, int) → tuple<int, bigint>", field: "sfunc"},
		{name: "sfunc wrong arg", req: AggregateRequest{Action: "create", Name: "a", ArgTypes: []string{"int"}, SFunc: "wrong_arg", SType: tup}, err: "no overload", field: "sfunc"},
		{name: "sfunc arity", req: AggregateRequest{Action: "create", Name: "a", ArgTypes: []string{"int", "int"}, SFunc: "state_avg", SType: tup}, err: "no overload", field: "sfunc"},
		{name: "sfunc required", req: AggregateRequest{Action: "create", Name: "a", ArgTypes: []string{"int"}, SType: tup}, err: "State function is required", field: "sfunc"},
		{name: "final missing", req: AggregateRequest{Action: "create", Name: "a", ArgTypes: []string{"int"}, SFunc: "state_avg", SType: tup, FinalFunc: "ghost"}, err: "not found", field: "finalfunc"},
		{name: "final wrong", req: AggregateRequest{Action: "create", Name: "a", ArgTypes: []string{"int"}, SFunc: "state_avg", SType: tup, FinalFunc: "state_avg"}, err: "no overload taking (tuple<int, bigint>)", field: "finalfunc"},
		{name: "initcond arity", req: AggregateRequest{Action: "create", Name: "a", ArgTypes: []string{"int"}, SFunc: "state_avg", SType: tup, InitCond: []byte(`[0]`)}, err: "does not match state type", field: "initcond"},
		{name: "initcond type", req: AggregateRequest{Action: "create", Name: "a", ArgTypes: []string{"int"}, SFunc: "state_avg", SType: tup, InitCond: []byte(`"abc"`)}, err: "does not match state type", field: "initcond"},
		{name: "initcond element", req: AggregateRequest{Action: "create", Name: "a", ArgTypes: []string{"int"}, SFunc: "state_avg", SType: tup, InitCond: []byte(`[0.5, 0]`)}, err: "not a valid int", field: "initcond"},
		{name: "bad name", req: AggregateRequest{Action: "create", Name: "1x", ArgTypes: []string{"int"}, SFunc: "state_avg", SType: tup}, err: "must start with a letter", field: "name"},
		{name: "bad stype", req: AggregateRequest{Action: "create", Name: "a", ArgTypes: []string{"int"}, SFunc: "state_avg", SType: "nope"}, field: "stype", err: ""},
		{name: "system", req: AggregateRequest{Keyspace: "system_x", Action: "create", Name: "a"}, err: "system keyspace", field: "keyspace"},
		{name: "keyspace", req: AggregateRequest{Keyspace: "zzz", Action: "create", Name: "a"}, err: "not found", field: "keyspace"},
		{name: "action", req: AggregateRequest{Action: "x", Name: "a"}, err: "Action must be", field: "action"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := PlanAggregate(aggregateSnapshot(), req(tt.req))
			if tt.field != "" {
				if len(p.Errors) == 0 {
					t.Fatalf("expected error on %s, got statement %q", tt.field, p.Statement)
				}
				e := p.Errors[0]
				if e.Field != tt.field || !strings.Contains(e.Message, tt.err) {
					t.Fatalf("got %+v, want field %s containing %q", p.Errors, tt.field, tt.err)
				}
				if p.Statement != "" {
					t.Fatalf("statement set despite errors: %q", p.Statement)
				}
				return
			}
			if len(p.Errors) > 0 {
				t.Fatalf("unexpected errors %+v", p.Errors)
			}
			if !strings.Contains(p.Statement, tt.want) {
				t.Fatalf("statement\n%s\nwant to contain\n%s", p.Statement, tt.want)
			}
			if tt.notes != "" && !strings.Contains(strings.Join(p.Notes, "|"), tt.notes) {
				t.Fatalf("notes %v missing %q", p.Notes, tt.notes)
			}
		})
	}
}

func TestAggregateCandidates(t *testing.T) {
	tup := "tuple<int, bigint>"
	got := AggregateCandidates(aggregateSnapshot(), "shop", []string{"int"}, tup, false)
	ok := map[string]bool{}
	for _, c := range got {
		ok[c.Name] = c.OK
		if !c.OK && c.Reason != "Needs (tuple<int, bigint>, int) → tuple<int, bigint>" {
			t.Fatalf("reason %q", c.Reason)
		}
	}
	if !ok["state_avg"] || !ok["state_strict"] || ok["wrong_ret"] || ok["wrong_arg"] || ok["final_avg"] {
		t.Fatalf("sfunc candidates %v", ok)
	}
	got = AggregateCandidates(aggregateSnapshot(), "shop", []string{"int"}, tup, true)
	ok = map[string]bool{}
	for _, c := range got {
		ok[c.Name] = c.OK
	}
	if !ok["final_avg"] || ok["state_avg"] {
		t.Fatalf("final candidates %v", ok)
	}
	if len(AggregateCandidates(aggregateSnapshot(), "zzz", nil, tup, false)) != 0 {
		t.Fatal("unknown keyspace should list nothing")
	}
}
