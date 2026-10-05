//go:build integration

package schema

import (
	"context"
	"testing"
)

func TestViewCreateAlterDrop(t *testing.T) {
	s := session(t)
	ctx := context.Background()
	for _, q := range []string{
		`CREATE KEYSPACE IF NOT EXISTS m908 WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}`,
		`DROP MATERIALIZED VIEW IF EXISTS m908.orders_by_status`,
		`DROP TABLE IF EXISTS m908.orders`,
		`CREATE TABLE m908.orders (merchant text, id uuid, status text, total int, PRIMARY KEY (merchant, id))`,
	} {
		if err := s.Query(q).Exec(); err != nil {
			t.Fatal(err)
		}
	}
	run := func(req ViewRequest) {
		t.Helper()
		snap, err := Build(ctx, s)
		if err != nil {
			t.Fatal(err)
		}
		req.Keyspace = "m908"
		plan := PlanView(snap, req)
		if len(plan.Errors) != 0 {
			t.Fatalf("%+v: %+v", req, plan.Errors)
		}
		if err := s.Query(plan.Statement).Exec(); err != nil {
			t.Fatalf("%s: %v", plan.Statement, err)
		}
	}
	gc := 3600
	run(ViewRequest{Name: "orders_by_status", BaseTable: "orders", Columns: []string{"total"},
		PartitionKey: []string{"status"}, Clustering: []TableClustering{{Column: "merchant"}, {Column: "id", Order: "DESC"}}})
	snap, err := Build(ctx, s)
	if err != nil {
		t.Fatal(err)
	}
	if snap.Keyspace("m908").View("orders_by_status") == nil {
		t.Fatal("view not created")
	}
	run(ViewRequest{Action: ViewAlter, Name: "orders_by_status", Alter: &AlterOptions{GCGraceSeconds: &gc}})
	run(ViewRequest{Action: ViewDropAction, Name: "orders_by_status"})
	snap, _ = Build(ctx, s)
	if snap.Keyspace("m908").View("orders_by_status") != nil {
		t.Fatal("view not dropped")
	}
}
