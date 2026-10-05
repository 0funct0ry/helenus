//go:build integration

package schema

import (
	"context"
	"testing"
)

func TestFunctionCreateReplaceDrop(t *testing.T) {
	s := session(t)
	ctx := context.Background()
	if err := s.Query(`CREATE KEYSPACE IF NOT EXISTS m909 WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}`).Exec(); err != nil {
		t.Fatal(err)
	}
	args := []FunctionArg{{Name: "amount", Type: "decimal"}, {Name: "rate", Type: "decimal"}}
	run := func(req FunctionRequest) {
		t.Helper()
		snap, err := Build(ctx, s)
		if err != nil {
			t.Fatal(err)
		}
		req.Keyspace = "m909"
		plan := PlanFunction(snap, req)
		if len(plan.Errors) != 0 {
			t.Fatalf("%+v: %+v", req, plan.Errors)
		}
		if err := s.Query(plan.Statement).Exec(); err != nil {
			t.Fatalf("%s: %v", plan.Statement, err)
		}
	}
	run(FunctionRequest{Action: FunctionCreate, Name: "add_tax", Args: args, Returns: "decimal",
		Body: "return amount.multiply(rate.add(java.math.BigDecimal.ONE));"})
	var got string
	if err := s.Query(`SELECT m909.add_tax(100, 0.2) FROM system.local`).Scan(&got); err != nil {
		t.Fatal(err)
	}
	run(FunctionRequest{Action: FunctionReplace, Name: "add_tax", Args: args, Returns: "decimal", Body: "return amount;"})
	snap, err := Build(ctx, s)
	if err != nil {
		t.Fatal(err)
	}
	if f := findFunction(snap.Keyspace("m909"), "add_tax", []string{"decimal", "decimal"}); f == nil || f.Body != "return amount;" {
		t.Fatalf("function after replace: %+v", f)
	}
	run(FunctionRequest{Action: FunctionDrop, Name: "add_tax", Args: args})
}
