package exec

import (
	"testing"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
	"github.com/stretchr/testify/require"
)

func TestParseUse(t *testing.T) {
	for in, want := range map[string]string{"USE payments": "payments", "use Payments;": "payments", `USE "MyKs"`: "MyKs"} {
		got, ok := parseUse(in)
		require.True(t, ok, in)
		require.Equal(t, want, got)
	}
	for _, in := range []string{"SELECT 1", "USER x", "USE a b"} {
		_, ok := parseUse(in)
		require.False(t, ok, in)
	}
}

func TestIsSchemaChange(t *testing.T) {
	require.True(t, isSchemaChange("create table t (a int primary key)"))
	require.True(t, isSchemaChange("DROP KEYSPACE k"))
	require.False(t, isSchemaChange("INSERT INTO t (a) VALUES (1)"))
}

func TestScanDestNullAndTuple(t *testing.T) {
	cols := []gocql.ColumnInfo{
		{Name: "a", TypeInfo: gocql.NewNativeType(5, gocql.TypeInt, "")},
		{Name: "t", TypeInfo: gocql.TupleTypeInfo{Elems: []gocql.TypeInfo{gocql.NewNativeType(5, gocql.TypeInt, ""), gocql.NewNativeType(5, gocql.TypeText, "")}}},
	}
	dest, finish := scanDest(cols)
	require.Len(t, dest, 3)
	out := finish()
	require.Nil(t, out[0])
	require.Equal(t, []any{nil, nil}, out[1])
}
