package exec

import (
	"testing"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
)

func TestMaskedColumns(t *testing.T) {
	cols := []gocql.ColumnInfo{
		{Keyspace: "system_auth", Table: "roles", Name: "role"},
		{Keyspace: "system_auth", Table: "roles", Name: "salted_hash"},
		{Keyspace: "shop", Table: "users", Name: "salted_hash"},
	}
	got := maskedColumns(cols)
	if len(got) != 1 || got[0] != 1 {
		t.Fatalf("got %v", got)
	}
}
