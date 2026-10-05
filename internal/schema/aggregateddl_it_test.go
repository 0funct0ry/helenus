//go:build integration

package schema

import (
	"context"
	"testing"
)

func TestAggregateCreateReplaceDrop(t *testing.T) {
	s := session(t)
	ctx := context.Background()
	if err := s.Query(`CREATE KEYSPACE IF NOT EXISTS m910 WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}`).Exec(); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`CREATE OR REPLACE FUNCTION m910.state_avg(state tuple<int, bigint>, val int) CALLED ON NULL INPUT RETURNS tuple<int, bigint> LANGUAGE java AS 'if (val != null) { state.setInt(0, state.getInt(0) + 1); state.setLong(1, state.getLong(1) + val.intValue()); } return state;'`,
		`CREATE OR REPLACE FUNCTION m910.final_avg(state tuple<int, bigint>) CALLED ON NULL INPUT RETURNS double LANGUAGE java AS 'if (state.getInt(0) == 0) return null; return Double.valueOf(state.getLong(1)) / state.getInt(0);'`,
	} {
		if err := s.Query(q).Exec(); err != nil {
			t.Fatal(err)
		}
	}
	run := func(req AggregateRequest) {
		t.Helper()
		snap, err := Build(ctx, s)
		if err != nil {
			t.Fatal(err)
		}
		req.Keyspace = "m910"
		plan := PlanAggregate(snap, req)
		if len(plan.Errors) != 0 {
			t.Fatalf("%+v: %+v", req, plan.Errors)
		}
		if err := s.Query(plan.Statement).Exec(); err != nil {
			t.Fatalf("%s: %v", plan.Statement, err)
		}
	}
	req := AggregateRequest{Name: "average", ArgTypes: []string{"int"}, SFunc: "state_avg", SType: "tuple<int, bigint>", FinalFunc: "final_avg", InitCond: []byte(`[0, 0]`)}
	req.Action = AggregateCreate
	run(req)
	snap, err := Build(ctx, s)
	if err != nil {
		t.Fatal(err)
	}
	if findAggregate(snap.Keyspace("m910"), "average", []string{"int"}) == nil {
		t.Fatal("aggregate not created")
	}
	req.Action = AggregateReplace
	req.InitCond = []byte(`[0, 10]`)
	run(req)
	run(AggregateRequest{Action: AggregateDrop, Name: "average", ArgTypes: []string{"int"}})
}
