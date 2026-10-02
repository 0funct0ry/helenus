package codec

import (
	"encoding/json"
	"math"
	"math/big"
	"net"
	"testing"
	"time"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
	"github.com/stretchr/testify/require"
)

func js(t *testing.T, v any) string {
	b, err := json.Marshal(v)
	require.NoError(t, err)
	return string(b)
}

func TestJSONScalars(t *testing.T) {
	e := Encoder{BlobLimit: DefaultBlobLimit}
	ts := time.Date(2026, 9, 30, 10, 0, 0, 5_000_000, time.UTC)
	cases := []struct {
		v    any
		td   TypeDesc
		want string
	}{
		{int64(9007199254740993), TypeDesc{Name: "bigint"}, `"9007199254740993"`},
		{big.NewInt(0).Lsh(big.NewInt(1), 80), TypeDesc{Name: "varint"}, `"1208925819614629174706176"`},
		{int32(7), TypeDesc{Name: "int"}, `7`},
		{float32(0.1), TypeDesc{Name: "float"}, `0.1`},
		{math.NaN(), TypeDesc{Name: "double"}, `"NaN"`},
		{math.Inf(-1), TypeDesc{Name: "double"}, `"-Infinity"`},
		{true, TypeDesc{Name: "boolean"}, `true`},
		{ts, TypeDesc{Name: "timestamp"}, `"2026-09-30T10:00:00.005Z"`},
		{ts, TypeDesc{Name: "date"}, `"2026-09-30"`},
		{time.Hour + 2*time.Minute + 3*time.Second + 4, TypeDesc{Name: "time"}, `"01:02:03.000000004"`},
		{gocql.Duration{Months: 1, Days: 2, Nanoseconds: int64(3*time.Hour + 4*time.Minute)}, TypeDesc{Name: "duration"}, `"1mo2d3h4m"`},
		{net.ParseIP("10.0.0.1"), TypeDesc{Name: "inet"}, `"10.0.0.1"`},
		{[]byte{0xca, 0xfe}, TypeDesc{Name: "blob"}, `"0xcafe"`},
		{(*int)(nil), TypeDesc{Name: "int"}, `null`},
		{nil, TypeDesc{Name: "text"}, `null`},
	}
	for _, c := range cases {
		require.Equal(t, c.want, js(t, e.JSON(c.v, c.td)), c.td.Name)
	}
}

func TestBlobTruncation(t *testing.T) {
	e := Encoder{BlobLimit: DefaultBlobLimit}
	got := js(t, e.JSON(make([]byte, 70000), TypeDesc{Name: "blob"}))
	require.Contains(t, got, `"$truncated":true`)
	require.Contains(t, got, `"bytes":70000`)
}

func TestCollections(t *testing.T) {
	e := Encoder{}
	m := map[string]int32{"b": 2, "a": 1}
	td := TypeDesc{Name: "map", Args: []TypeDesc{{Name: "text"}, {Name: "int"}}}
	require.Equal(t, `[["a",1],["b",2]]`, js(t, e.JSON(m, td)))
	require.Equal(t, "{'a': 1, 'b': 2}", e.Text(m, td))
	l := []string{"x", "y'z"}
	ltd := TypeDesc{Name: "list", Args: []TypeDesc{{Name: "text"}}}
	require.Equal(t, `["x","y'z"]`, js(t, e.JSON(l, ltd)))
	require.Equal(t, "['x', 'y''z']", e.Text(l, ltd))
	st := TypeDesc{Name: "set", Args: []TypeDesc{{Name: "int"}}}
	require.Equal(t, "{1, 2}", e.Text([]int{1, 2}, st))
	require.Equal(t, "0xcafe", e.Text([]byte{0xca, 0xfe}, TypeDesc{Name: "blob"}))
	require.Equal(t, "plain", e.Text("plain", TypeDesc{Name: "text"}))
	require.Equal(t, "null", e.Text(nil, TypeDesc{Name: "text"}))
	require.Equal(t, "2026-09-30 10:00:00.000Z", e.Text(time.Date(2026, 9, 30, 10, 0, 0, 0, time.UTC), TypeDesc{Name: "timestamp"}))
}

func TestUDT(t *testing.T) {
	e := Encoder{UDTFields: func(UDTRef) map[string]TypeDesc {
		return map[string]TypeDesc{"day": {Name: "date"}, "n": {Name: "bigint"}}
	}}
	td := TypeDesc{Name: "address", UDT: &UDTRef{Keyspace: "k", Name: "address"}}
	v := map[string]any{"n": int64(5), "day": time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC), "city": "Oslo"}
	require.Equal(t, `{"city":"Oslo","day":"2026-01-02","n":"5"}`, js(t, e.JSON(v, td)))
}

func TestDurationZero(t *testing.T) {
	require.Equal(t, "0s", FormatDuration(gocql.Duration{}))
	require.Equal(t, "-1d", FormatDuration(gocql.Duration{Days: -1}))
}
