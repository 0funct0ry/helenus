//go:build integration

package schema

import (
	"context"
	"testing"
)

func TestKeyspaceCreate(t *testing.T) {
	s := session(t)
	ctx := context.Background()
	snap, err := Build(ctx, s)
	if err != nil {
		t.Fatal(err)
	}
	dc := ""
	if err := s.Query("SELECT data_center FROM system.local").Scan(&dc); err != nil {
		t.Fatal(err)
	}
	for _, req := range []KeyspaceRequest{
		{Name: "m901_simple", Strategy: StrategySimple, ReplicationFactor: 1, DurableWrites: true},
		{Name: "M901_Nts", Strategy: StrategyNTS, Datacenters: []DCRequest{{dc, 1}}, DurableWrites: false},
	} {
		plan := PlanKeyspace(snap, req, nil)
		if len(plan.Errors) != 0 {
			t.Fatalf("%s: %+v", req.Name, plan.Errors)
		}
		if err := s.Query(plan.Statement).Exec(); err != nil {
			t.Fatalf("%s: %v", plan.Statement, err)
		}
	}
	snap, err = Build(ctx, s)
	if err != nil {
		t.Fatal(err)
	}
	if snap.Keyspace("m901_simple") == nil || snap.Keyspace("M901_Nts") == nil {
		t.Fatal("created keyspaces missing from snapshot")
	}
}
