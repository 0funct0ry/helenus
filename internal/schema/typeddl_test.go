package schema

import (
	"strings"
	"testing"

	"github.com/0funct0ry/helenus/internal/codec"
)

func nat(n string) codec.TypeDesc { return codec.TypeDesc{Name: n} }
func ref(n string) codec.TypeDesc {
	return codec.TypeDesc{Name: n, UDT: &codec.UDTRef{Keyspace: "payments", Name: n}}
}
func coll(n string, args ...codec.TypeDesc) codec.TypeDesc {
	return codec.TypeDesc{Name: n, Args: args}
}

func typeSnapshot() *Snapshot {
	kss, _, _, types := ledgerRows()
	snap := assemble(kss, nil, nil, nil, nil, types, nil, nil)
	snap.Keyspaces = append(snap.Keyspaces, Keyspace{Name: "system_x", System: true})
	return snap
}

func TestPlanTypeStatements(t *testing.T) {
	frozenAddr := ref("address")
	frozenAddr.Frozen = true
	cases := []struct {
		name string
		req  TypeRequest
		want string
	}{
		{"create simple", TypeRequest{Action: TypeCreate, Keyspace: "payments", Name: "geo_point", Fields: []FieldSpec{{"lat", nat("double")}, {"lon", nat("double")}}},
			"CREATE TYPE payments.geo_point (\n    lat double,\n    lon double\n);"},
		{"create nested freezes", TypeRequest{Action: TypeCreate, Keyspace: "payments", Name: "shop", Fields: []FieldSpec{
			{"tags", coll("set", nat("text"))}, {"addr", ref("address")}, {"pair", coll("tuple", nat("int"), nat("text"))}, {"embedding", codec.TypeDesc{Name: "vector", Args: []codec.TypeDesc{nat("float")}, Size: 3}}}},
			"CREATE TYPE payments.shop (\n    tags frozen<set<text>>,\n    addr frozen<address>,\n    pair frozen<tuple<int, text>>,\n    embedding vector<float, 3>\n);"},
		{"create keeps explicit frozen", TypeRequest{Action: TypeCreate, Keyspace: "payments", Name: "wrap", Fields: []FieldSpec{{"a", frozenAddr}}},
			"CREATE TYPE payments.wrap (\n    a frozen<address>\n);"},
		{"create quotes identifiers", TypeRequest{Action: TypeCreate, Keyspace: "payments", Name: "Order", Fields: []FieldSpec{{"select", nat("int")}, {"Mixed Case", nat("text")}}},
			"CREATE TYPE payments.\"Order\" (\n    \"select\" int,\n    \"Mixed Case\" text\n);"},
		{"add field", TypeRequest{Action: TypeAddField, Keyspace: "payments", Name: "address", Field: &FieldSpec{"zip", nat("text")}},
			"ALTER TYPE payments.address ADD zip text;"},
		{"rename field", TypeRequest{Action: TypeRenameField, Keyspace: "payments", Name: "address", From: "city", To: "town"},
			"ALTER TYPE payments.address RENAME city TO town;"},
		{"drop unused", TypeRequest{Action: TypeDrop, Keyspace: "payments", Name: "profile"}, "DROP TYPE payments.profile;"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := PlanType(typeSnapshot(), tc.req)
			if len(p.Errors) > 0 {
				t.Fatalf("unexpected errors: %v", p.Errors)
			}
			if p.Statement != tc.want {
				t.Errorf("got\n%s\nwant\n%s", p.Statement, tc.want)
			}
		})
	}
}

func TestPlanTypeNotesFreezing(t *testing.T) {
	p := PlanType(typeSnapshot(), TypeRequest{Action: TypeAddField, Keyspace: "payments", Name: "address", Field: &FieldSpec{"tags", coll("list", nat("text"))}})
	if len(p.Notes) != 1 || !strings.Contains(p.Notes[0], "tags") {
		t.Errorf("notes = %v", p.Notes)
	}
}

func TestPlanTypeErrors(t *testing.T) {
	cases := []struct {
		name string
		req  TypeRequest
		want string
	}{
		{"missing keyspace", TypeRequest{Action: TypeCreate, Name: "x"}, "keyspace is required"},
		{"unknown keyspace", TypeRequest{Action: TypeCreate, Keyspace: "nope", Name: "x"}, "not found"},
		{"system keyspace", TypeRequest{Action: TypeCreate, Keyspace: "system_x", Name: "x"}, "system keyspace"},
		{"empty name", TypeRequest{Action: TypeCreate, Keyspace: "payments", Fields: []FieldSpec{{"a", nat("int")}}}, "type name is required"},
		{"long name", TypeRequest{Action: TypeCreate, Keyspace: "payments", Name: strings.Repeat("a", 49), Fields: []FieldSpec{{"a", nat("int")}}}, "longer than 48"},
		{"exists", TypeRequest{Action: TypeCreate, Keyspace: "payments", Name: "address", Fields: []FieldSpec{{"a", nat("int")}}}, "already exists"},
		{"no fields", TypeRequest{Action: TypeCreate, Keyspace: "payments", Name: "x"}, "at least one field"},
		{"dup field", TypeRequest{Action: TypeCreate, Keyspace: "payments", Name: "x", Fields: []FieldSpec{{"a", nat("int")}, {"a", nat("text")}}}, "listed twice"},
		{"empty field name", TypeRequest{Action: TypeCreate, Keyspace: "payments", Name: "x", Fields: []FieldSpec{{"", nat("int")}}}, "field name is required"},
		{"unknown type", TypeRequest{Action: TypeCreate, Keyspace: "payments", Name: "x", Fields: []FieldSpec{{"a", nat("strng")}}}, "unknown type"},
		{"counter", TypeRequest{Action: TypeCreate, Keyspace: "payments", Name: "x", Fields: []FieldSpec{{"a", nat("counter")}}}, "counter"},
		{"missing udt", TypeRequest{Action: TypeCreate, Keyspace: "payments", Name: "x", Fields: []FieldSpec{{"a", ref("ghost")}}}, "not found in payments"},
		{"foreign udt", TypeRequest{Action: TypeCreate, Keyspace: "payments", Name: "x", Fields: []FieldSpec{{"a", codec.TypeDesc{Name: "t", UDT: &codec.UDTRef{Keyspace: "other", Name: "t"}}}}}, "another keyspace"},
		{"self reference", TypeRequest{Action: TypeAddField, Keyspace: "payments", Name: "address", Field: &FieldSpec{"a", ref("address")}}, "contain itself"},
		{"cycle", TypeRequest{Action: TypeAddField, Keyspace: "payments", Name: "address", Field: &FieldSpec{"p", ref("profile")}}, "depend on itself"},
		{"bad map", TypeRequest{Action: TypeCreate, Keyspace: "payments", Name: "x", Fields: []FieldSpec{{"a", coll("map", nat("int"))}}}, "map takes"},
		{"add dup", TypeRequest{Action: TypeAddField, Keyspace: "payments", Name: "address", Field: &FieldSpec{"city", nat("text")}}, "listed twice"},
		{"add missing type", TypeRequest{Action: TypeAddField, Keyspace: "payments", Name: "ghost", Field: &FieldSpec{"a", nat("int")}}, "type payments.ghost not found"},
		{"rename missing", TypeRequest{Action: TypeRenameField, Keyspace: "payments", Name: "address", From: "zip", To: "z"}, "no field zip"},
		{"rename taken", TypeRequest{Action: TypeRenameField, Keyspace: "payments", Name: "address", From: "city", To: "city"}, "same as the old"},
		{"drop in use", TypeRequest{Action: TypeDrop, Keyspace: "payments", Name: "address"}, "is used by profile.home"},
		{"drop missing", TypeRequest{Action: TypeDrop, Keyspace: "payments", Name: "ghost"}, "not found"},
		{"bad action", TypeRequest{Action: "explode", Keyspace: "payments", Name: "address"}, "unknown action"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := PlanType(typeSnapshot(), tc.req)
			if p.Statement != "" {
				t.Errorf("statement should be empty, got %q", p.Statement)
			}
			if !strings.Contains(strings.Join(p.Errors, "; "), tc.want) {
				t.Errorf("errors %v lack %q", p.Errors, tc.want)
			}
		})
	}
}

func TestPlanTypeDropListsDependents(t *testing.T) {
	p := PlanType(typeSnapshot(), TypeRequest{Action: TypeDrop, Keyspace: "payments", Name: "address"})
	if len(p.Dependents) != 1 || p.Dependents[0] != "profile.home" {
		t.Errorf("dependents = %v", p.Dependents)
	}
}

func TestUDTUsageIncludesFunctionsAndAggregates(t *testing.T) {
	kss, _, _, types := ledgerRows()
	fns := []row{{"keyspace_name": "payments", "function_name": "geo", "argument_names": []string{"a"}, "argument_types": []string{"frozen<address>"}, "return_type": "int", "language": "java", "body": "return 1;", "called_on_null_input": false}}
	snap := assemble(kss, nil, nil, nil, nil, types, fns, nil)
	got := snap.Keyspace("payments").Type("address").UsedBy
	want := "geo(frozen<address>)"
	found := false
	for _, u := range got {
		found = found || u == want
	}
	if !found {
		t.Errorf("UsedBy = %v, want %s included", got, want)
	}
}
