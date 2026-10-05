//go:build integration

package schema

import (
	"context"
	"testing"
)

func TestTriggerMissingClass(t *testing.T) {
	s := session(t)
	for _, q := range []string{
		`CREATE KEYSPACE IF NOT EXISTS m911 WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}`,
		`DROP TABLE IF EXISTS m911.items`,
		`CREATE TABLE m911.items (id uuid PRIMARY KEY, name text)`,
	} {
		if err := s.Query(q).Exec(); err != nil {
			t.Fatal(err)
		}
	}
	snap, err := Build(context.Background(), s)
	if err != nil {
		t.Fatal(err)
	}
	plan := PlanTrigger(snap, TriggerRequest{Action: TriggerCreate, Keyspace: "m911", Table: "items", Name: "audit", Class: "com.example.Missing"})
	if len(plan.Errors) != 0 {
		t.Fatalf("%+v", plan.Errors)
	}
	if err := s.Query(plan.Statement).Exec(); err == nil {
		t.Fatal("expected the server to reject a trigger class that is not installed")
	}
	snap, err = Build(context.Background(), s)
	if err != nil {
		t.Fatal(err)
	}
	if n := len(snap.Keyspace("m911").Table("items").Triggers); n != 0 {
		t.Errorf("%d triggers added", n)
	}
}
