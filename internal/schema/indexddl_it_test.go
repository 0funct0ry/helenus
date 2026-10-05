//go:build integration

package schema

import (
	"context"
	"testing"
)

func TestIndexCreateDrop(t *testing.T) {
	s := session(t)
	ctx := context.Background()
	sai := MajorVersion(itVersion()) >= 5
	stmts := []string{
		`CREATE KEYSPACE IF NOT EXISTS m907 WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}`,
		`DROP TABLE IF EXISTS m907.items`,
		`CREATE TABLE m907.items (id uuid PRIMARY KEY, name text, attrs map<text,int>, tags set<text>)`,
	}
	if sai {
		stmts[2] = `CREATE TABLE m907.items (id uuid PRIMARY KEY, name text, attrs map<text,int>, tags set<text>, emb vector<float, 3>)`
	}
	for _, q := range stmts {
		if err := s.Query(q).Exec(); err != nil {
			t.Fatal(err)
		}
	}
	run := func(req IndexRequest) {
		t.Helper()
		snap, err := Build(ctx, s)
		if err != nil {
			t.Fatal(err)
		}
		req.Keyspace = "m907"
		plan := PlanIndex(snap, req)
		if len(plan.Errors) != 0 {
			t.Fatalf("%+v: %+v", req, plan.Errors)
		}
		if err := s.Query(plan.Statement).Exec(); err != nil {
			t.Fatalf("%s: %v", plan.Statement, err)
		}
	}
	run(IndexRequest{Table: "items", Column: "name"})
	run(IndexRequest{Table: "items", Column: "attrs", Target: "KEYS"})
	run(IndexRequest{Table: "items", Column: "tags"})
	if sai {
		run(IndexRequest{Table: "items", Column: "emb", Kind: "sai", Options: IndexOptions{SimilarityFunction: "cosine"}})
	}
	snap, err := Build(ctx, s)
	if err != nil {
		t.Fatal(err)
	}
	want := 3
	if sai {
		want = 4
	}
	if got := len(snap.Keyspace("m907").Table("items").Indexes); got != want {
		t.Fatalf("indexes = %d, want %d", got, want)
	}
	run(IndexRequest{Action: IndexDrop, Name: "items_name_idx"})
	run(IndexRequest{Action: IndexDrop, Name: "items_attrs_idx"})
	run(IndexRequest{Action: IndexDrop, Name: "items_tags_idx"})
	if sai {
		run(IndexRequest{Action: IndexDrop, Name: "items_emb_idx"})
	}
}
