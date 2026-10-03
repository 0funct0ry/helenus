//go:build integration

package schema

import (
	"context"
	"testing"

	"github.com/0funct0ry/helenus/internal/codec"
)

// TestTypeLifecycle plans and runs create, add field, rename field and drop against a real node,
// reading the snapshot back after each step.
func TestTypeLifecycle(t *testing.T) {
	ctx := context.Background()
	s := session(t)
	loadFixture(t, s, "testdata/fixture.cql")

	run := func(req TypeRequest) *Snapshot {
		t.Helper()
		snap, err := Build(ctx, s)
		if err != nil {
			t.Fatal(err)
		}
		plan := PlanType(snap, req)
		if len(plan.Errors) > 0 {
			t.Fatalf("%s: %v", req.Action, plan.Errors)
		}
		if err := s.Query(plan.Statement).Exec(); err != nil {
			t.Fatalf("%s: %v\n%s", req.Action, err, plan.Statement)
		}
		snap, err = Build(ctx, s)
		if err != nil {
			t.Fatal(err)
		}
		return snap
	}
	dbl := codec.TypeDesc{Name: "double"}

	snap := run(TypeRequest{Action: TypeCreate, Keyspace: "payments", Name: "geo_test", Fields: []FieldSpec{
		{Name: "lat", Type: dbl}, {Name: "lon", Type: dbl},
		{Name: "tags", Type: codec.TypeDesc{Name: "set", Args: []codec.TypeDesc{{Name: "text"}}}},
		{Name: "addr", Type: codec.TypeDesc{Name: "address", UDT: &codec.UDTRef{Keyspace: "payments", Name: "address"}}},
	}})
	u := snap.Keyspace("payments").Type("geo_test")
	if u == nil || len(u.Fields) != 4 {
		t.Fatalf("type not created: %+v", u)
	}

	snap = run(TypeRequest{Action: TypeAddField, Keyspace: "payments", Name: "geo_test", Field: &FieldSpec{Name: "alt", Type: dbl}})
	if len(snap.Keyspace("payments").Type("geo_test").Fields) != 5 {
		t.Error("field not added")
	}

	snap = run(TypeRequest{Action: TypeRenameField, Keyspace: "payments", Name: "geo_test", From: "lat", To: "latitude"})
	found := false
	for _, f := range snap.Keyspace("payments").Type("geo_test").Fields {
		found = found || f.Name == "latitude"
	}
	if !found {
		t.Error("field not renamed")
	}

	snap, err := Build(ctx, s)
	if err != nil {
		t.Fatal(err)
	}
	if p := PlanType(snap, TypeRequest{Action: TypeDrop, Keyspace: "payments", Name: "address"}); len(p.Errors) == 0 {
		t.Error("dropping a used type should be refused")
	}

	snap = run(TypeRequest{Action: TypeDrop, Keyspace: "payments", Name: "geo_test"})
	if snap.Keyspace("payments").Type("geo_test") != nil {
		t.Error("type not dropped")
	}
}
