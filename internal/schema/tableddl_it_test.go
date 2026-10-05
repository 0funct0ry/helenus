//go:build integration

package schema

import (
	"context"
	"testing"
)

func TestTableCreate(t *testing.T) {
	s := session(t)
	ctx := context.Background()
	if err := s.Query("CREATE KEYSPACE IF NOT EXISTS m902 WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}").Exec(); err != nil {
		t.Fatal(err)
	}
	snap, err := Build(ctx, s)
	if err != nil {
		t.Fatal(err)
	}
	ttl, grace := 7200, 1000
	req := TableRequest{Keyspace: "m902", Name: "events",
		Columns:      []TableColumn{tcol("tenant", "text"), tcol("day", "date"), tcol("ts", "timeuuid"), tcol("payload", "text")},
		PartitionKey: []string{"tenant", "day"},
		Clustering:   []TableClustering{{"ts", "DESC"}},
		Options: TableOptions{Comment: "it's", DefaultTTLSeconds: ttl, GCGraceSeconds: &grace,
			Compaction: TableCompaction{Class: CompactionLCS}}}
	plan := PlanTable(snap, req)
	if len(plan.Errors) != 0 {
		t.Fatalf("%+v", plan.Errors)
	}
	if err := s.Query(plan.Statement).Exec(); err != nil {
		t.Fatalf("%s: %v", plan.Statement, err)
	}
	snap, err = Build(ctx, s)
	if err != nil {
		t.Fatal(err)
	}
	tbl := snap.Keyspace("m902").Table("events")
	if tbl == nil {
		t.Fatal("table missing")
	}
	var pk, ck []string
	for _, c := range tbl.Columns {
		switch c.Kind {
		case KindPartition:
			pk = append(pk, c.Name)
		case KindClustering:
			ck = append(ck, c.Name+" "+c.Order)
		}
	}
	if len(pk) != 2 || pk[0] != "tenant" || pk[1] != "day" || len(ck) != 1 || ck[0] != "ts DESC" {
		t.Errorf("keys: pk=%v ck=%v", pk, ck)
	}
	opts := map[string]string{}
	for _, o := range tbl.Options {
		opts[o.Name] = o.Value
	}
	if opts["default_time_to_live"] != "7200" || opts["gc_grace_seconds"] != "1000" {
		t.Errorf("options: %v", opts)
	}
}
