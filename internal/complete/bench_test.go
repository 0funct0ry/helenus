package complete

import (
	"context"
	"fmt"
	"sort"
	"testing"
	"time"

	"github.com/0funct0ry/helenus/internal/schema"
)

// bigSnapshot is much larger than the fixture schema: 10 keyspaces of 50 tables with 30 columns.
func bigSnapshot() *schema.Snapshot {
	snap := fixtureSnapshot()
	for k := 0; k < 10; k++ {
		ks := schema.Keyspace{Name: fmt.Sprintf("ks%d", k)}
		for t := 0; t < 50; t++ {
			tb := schema.Table{Keyspace: ks.Name, Name: fmt.Sprintf("table_%d", t)}
			tb.Columns = append(tb.Columns, col("id", "uuid", schema.KindPartition, 1, ""), col("ts", "timeuuid", schema.KindClustering, 1, "DESC"))
			for c := 0; c < 28; c++ {
				tb.Columns = append(tb.Columns, col(fmt.Sprintf("col_%d", c), "text", schema.KindRegular, 0, ""))
			}
			ks.Tables = append(ks.Tables, tb)
		}
		snap.Keyspaces = append(snap.Keyspaces, ks)
	}
	return snap
}

var benchInputs = []string{
	"",
	"SELECT * FROM payments.transactions_by_merchant WHERE ",
	"SELECT * FROM ks3.table_7 WHERE ",
	"SELECT  FROM ks3.table_7",
	"INSERT INTO ks1.table_2 (",
	"CREATE TABLE t (id uuid PRIMARY KEY, v ",
	"CONSISTENCY ",
	"SELECT * FROM ",
	"BEGIN BATCH INSERT INTO ks1.table_2 (id) VALUES (uuid()); UPDATE ks2.table_9 SET ",
}

func BenchmarkComplete(b *testing.B) {
	snap := bigSnapshot()
	ctx := context.Background()
	for i := 0; i < b.N; i++ {
		in := benchInputs[i%len(benchInputs)]
		Complete(ctx, snap, "payments", in, len(in))
	}
}

// TestLatencyP95 holds the SPEC §10 budget: p95 completion latency under 5 ms, here on a schema
// about twenty times the fixture's size and with the race detector's slowdown still in budget.
func TestLatencyP95(t *testing.T) {
	snap := bigSnapshot()
	ctx := context.Background()
	var d []time.Duration
	for i := 0; i < 2000; i++ {
		in := benchInputs[i%len(benchInputs)]
		start := time.Now()
		Complete(ctx, snap, "payments", in, len(in))
		d = append(d, time.Since(start))
	}
	sort.Slice(d, func(i, j int) bool { return d[i] < d[j] })
	if p95 := d[len(d)*95/100]; p95 > 5*time.Millisecond {
		t.Errorf("p95 = %v, want < 5ms", p95)
	} else {
		t.Logf("p95 = %v", p95)
	}
}
