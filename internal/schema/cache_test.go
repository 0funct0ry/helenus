package schema

import (
	"context"
	"testing"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
)

func TestCacheRefreshesOnlyWhenAsked(t *testing.T) {
	n := 0
	c := NewCache()
	c.build = func(context.Context, *gocql.Session) (*Snapshot, error) {
		n++
		return &Snapshot{Version: "5.0"}, nil
	}
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		if _, err := c.Get(ctx, "p", nil); err != nil {
			t.Fatal(err)
		}
	}
	if n != 1 {
		t.Fatalf("built %d times, want 1", n)
	}
	_, _ = c.Refresh(ctx, "p", nil)
	c.Invalidate("p")
	_, _ = c.Get(ctx, "p", nil)
	if n != 3 {
		t.Fatalf("built %d times, want 3", n)
	}
}
