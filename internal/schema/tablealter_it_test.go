//go:build integration

package schema

import (
	"context"
	"testing"
)

func TestTableAlterTruncateDrop(t *testing.T) {
	s := session(t)
	ctx := context.Background()
	for _, q := range []string{
		`CREATE KEYSPACE IF NOT EXISTS m906 WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}`,
		`DROP TABLE IF EXISTS m906.users`,
		`CREATE TABLE m906.users (id uuid, ts timeuuid, name text, extra text, PRIMARY KEY (id, ts))`,
	} {
		if err := s.Query(q).Exec(); err != nil {
			t.Fatal(err)
		}
	}
	run := func(req TableRequest) {
		t.Helper()
		snap, err := Build(ctx, s)
		if err != nil {
			t.Fatal(err)
		}
		req.Keyspace, req.Name = "m906", "users"
		plan := PlanTable(snap, req)
		if len(plan.Errors) != 0 {
			t.Fatalf("%+v: %+v", req, plan.Errors)
		}
		if err := s.Query(plan.Statement).Exec(); err != nil {
			t.Fatalf("%s: %v", plan.Statement, err)
		}
	}
	ttl := 86400
	run(TableRequest{Action: TableAddColumn, Column: tcol("phone", "text")})
	run(TableRequest{Action: TableRenameColumn, From: "ts", To: "at"})
	run(TableRequest{Action: TableDropColumn, Column: TableColumn{Name: "extra"}})
	run(TableRequest{Action: TableOptionsAlter, Alter: &AlterOptions{DefaultTTLSeconds: &ttl}})
	run(TableRequest{Action: TableTruncate})
	snap, err := Build(ctx, s)
	if err != nil {
		t.Fatal(err)
	}
	// extra was dropped as text; re-adding it with another type must be refused from dropped_columns.
	req := TableRequest{Action: TableAddColumn, Keyspace: "m906", Name: "users", Column: tcol("extra", "int")}
	if p := PlanTable(snap, req); len(p.Errors) == 0 {
		t.Fatal("re-adding a dropped column with a different type should fail")
	}
	run(TableRequest{Action: TableDrop})
}
