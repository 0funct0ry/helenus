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
	"gopkg.in/inf.v0"
)

func decode(t *testing.T, raw string, td TypeDesc) any {
	t.Helper()
	v, err := Decode(json.RawMessage(raw), td, testUDTs)
	require.NoError(t, err, raw)
	return v
}

func decodeErr(t *testing.T, raw string, td TypeDesc) string {
	t.Helper()
	_, err := Decode(json.RawMessage(raw), td, testUDTs)
	require.Error(t, err, raw)
	return err.Error()
}

func mustUUID(s string) gocql.UUID {
	u, err := gocql.ParseUUID(s)
	if err != nil {
		panic(err)
	}
	return u
}

var addrRef = UDTRef{Keyspace: "payments", Name: "address"}

func testUDTs(r UDTRef) map[string]TypeDesc {
	if r == addrRef {
		return map[string]TypeDesc{"city": {Name: "text"}, "zip": {Name: "bigint"}, "id": {Name: "uuid"}}
	}
	return nil
}

func TestDecodeScalars(t *testing.T) {
	ts := time.Date(2026, 9, 30, 10, 0, 0, 5_000_000, time.UTC)
	cases := []struct {
		raw  string
		td   TypeDesc
		want any
	}{
		{`"hi"`, TypeDesc{Name: "text"}, "hi"},
		{`true`, TypeDesc{Name: "boolean"}, true},
		{`-128`, TypeDesc{Name: "tinyint"}, int8(-128)},
		{`32767`, TypeDesc{Name: "smallint"}, int16(32767)},
		{`7`, TypeDesc{Name: "int"}, int32(7)},
		{`"9007199254740993"`, TypeDesc{Name: "bigint"}, int64(9007199254740993)},
		{`"-5"`, TypeDesc{Name: "counter"}, int64(-5)},
		{`"1208925819614629174706176"`, TypeDesc{Name: "varint"}, new(big.Int).Lsh(big.NewInt(1), 80)},
		{`"12.50"`, TypeDesc{Name: "decimal"}, inf.NewDec(1250, 2)},
		{`0.5`, TypeDesc{Name: "float"}, float32(0.5)},
		{`1e3`, TypeDesc{Name: "double"}, float64(1000)},
		{`"-Infinity"`, TypeDesc{Name: "double"}, math.Inf(-1)},
		{`"7c9e6679-7425-40de-944b-e07fc1f90ae7"`, TypeDesc{Name: "uuid"}, mustUUID("7c9e6679-7425-40de-944b-e07fc1f90ae7")},
		{`"10.0.0.1"`, TypeDesc{Name: "inet"}, net.ParseIP("10.0.0.1")},
		{`"0xcafe"`, TypeDesc{Name: "blob"}, []byte{0xca, 0xfe}},
		{`"0x"`, TypeDesc{Name: "blob"}, []byte{}},
		{`"2026-09-30T10:00:00.005Z"`, TypeDesc{Name: "timestamp"}, ts},
		{`"2026-09-30"`, TypeDesc{Name: "date"}, time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)},
		{`"01:02:03.000000004"`, TypeDesc{Name: "time"}, time.Hour + 2*time.Minute + 3*time.Second + 4},
		{`"1mo2d3h4m"`, TypeDesc{Name: "duration"}, gocql.Duration{Months: 1, Days: 2, Nanoseconds: int64(3*time.Hour + 4*time.Minute)}},
		{`null`, TypeDesc{Name: "text"}, nil},
	}
	for _, c := range cases {
		got := decode(t, c.raw, c.td)
		if d, ok := c.want.(*inf.Dec); ok {
			require.Zero(t, d.Cmp(got.(*inf.Dec)), c.raw)
			continue
		}
		require.Equal(t, c.want, got, c.td.Name+" "+c.raw)
	}
}

func TestDecodeErrors(t *testing.T) {
	cases := []struct {
		raw  string
		td   TypeDesc
		want string
	}{
		{`128`, TypeDesc{Name: "tinyint"}, "out of range"},
		{`2147483648`, TypeDesc{Name: "int"}, "out of range"},
		{`1.5`, TypeDesc{Name: "int"}, "integer"},
		{`"abc"`, TypeDesc{Name: "uuid"}, "not a valid UUID"},
		{`"7c9e6679-7425-40de-944b-e07fc1f90ae7"`, TypeDesc{Name: "timeuuid"}, "version 1"},
		{`"300.1.1.1"`, TypeDesc{Name: "inet"}, "not a valid IP"},
		{`"cafe"`, TypeDesc{Name: "blob"}, "must start with 0x"},
		{`"0xzz"`, TypeDesc{Name: "blob"}, "not valid hex"},
		{`{"$truncated":true,"preview":"0x00","bytes":99999}`, TypeDesc{Name: "blob"}, "truncated"},
		{`"2026-13-01"`, TypeDesc{Name: "date"}, "YYYY-MM-DD"},
		{`"25:00:00"`, TypeDesc{Name: "time"}, "not HH:MM:SS"},
		{`"yesterday"`, TypeDesc{Name: "timestamp"}, "ISO-8601"},
		{`"x"`, TypeDesc{Name: "decimal"}, "decimal"},
		{`"3 weeks"`, TypeDesc{Name: "duration"}, "not a duration"},
		{`[1,null]`, TypeDesc{Name: "list", Args: []TypeDesc{{Name: "int"}}}, "null"},
		{`[1,2]`, TypeDesc{Name: "vector", Args: []TypeDesc{{Name: "float"}}, Size: 3}, "exactly 3"},
		{`[[1,"a"],[1,"b"]]`, TypeDesc{Name: "map", Args: []TypeDesc{{Name: "int"}, {Name: "text"}}}, "duplicate"},
		{`{"nope":1}`, TypeDesc{Name: "address", UDT: &addrRef}, "no field"},
		{`{}`, TypeDesc{Name: "other", UDT: &UDTRef{Keyspace: "k", Name: "other"}}, "unknown user-defined type"},
	}
	for _, c := range cases {
		require.Contains(t, decodeErr(t, c.raw, c.td), c.want, c.raw)
	}
}

func TestDecodeCollections(t *testing.T) {
	set := TypeDesc{Name: "set", Args: []TypeDesc{{Name: "text"}}}
	require.Equal(t, []any{"a", "b"}, decode(t, `["a","b"]`, set))

	tuple := TypeDesc{Name: "tuple", Args: []TypeDesc{{Name: "double"}, {Name: "text"}}}
	require.Equal(t, []any{1.5, nil}, decode(t, `[1.5,null]`, tuple))

	m := TypeDesc{Name: "map", Args: []TypeDesc{{Name: "text"}, {Name: "int"}}}
	require.Equal(t, map[any]any{"a": int32(1), "b": int32(2)}, decode(t, `[["a",1],["b",2]]`, m))

	blobKeys := TypeDesc{Name: "map", Args: []TypeDesc{{Name: "blob"}, {Name: "int"}}}
	got, ok := decode(t, `[["0x01",1],["0x02",2]]`, blobKeys).(Map)
	require.True(t, ok, "blob keys cannot be Go map keys")
	require.Equal(t, []any{[]byte{1}, []byte{2}}, got.Keys)

	udt := TypeDesc{Name: "address", UDT: &addrRef}
	require.Equal(t,
		map[string]any{"city": "Pune", "zip": int64(411001)},
		decode(t, `{"city":"Pune","zip":"411001"}`, udt))
}

func TestParseDuration(t *testing.T) {
	for _, s := range []string{"1mo2d3h4m", "0s", "5s", "1h30m", "250ms", "3us", "7ns", "-2d", "1mo2d3h4m5s6ms7us8ns"} {
		d, err := ParseDuration(s)
		require.NoError(t, err, s)
		require.Equal(t, s, FormatDuration(d))
	}
	d, err := ParseDuration("1y2w")
	require.NoError(t, err)
	require.Equal(t, gocql.Duration{Months: 12, Days: 14}, d)
	for _, s := range []string{"", "h", "5", "5x", "-", "1h-1m"} {
		_, err := ParseDuration(s)
		require.Error(t, err, s)
	}
}

// Decode inverts Encoder.JSON for the shapes the grid sends back.
func TestDecodeRoundTrip(t *testing.T) {
	e := Encoder{UDTFields: testUDTs}
	udt := TypeDesc{Name: "address", UDT: &addrRef}
	cases := []struct {
		v  any
		td TypeDesc
	}{
		{int64(-42), TypeDesc{Name: "bigint"}},
		{big.NewInt(99), TypeDesc{Name: "varint"}},
		{float32(0.25), TypeDesc{Name: "float"}},
		{[]byte{1, 2, 3}, TypeDesc{Name: "blob"}},
		{time.Date(2026, 1, 2, 3, 4, 5, 6_000_000, time.UTC), TypeDesc{Name: "timestamp"}},
		{[]any{"x", "y"}, TypeDesc{Name: "list", Args: []TypeDesc{{Name: "text"}}}},
		{map[string]any{"city": "Pune", "zip": int64(1)}, udt},
	}
	for _, c := range cases {
		raw, err := json.Marshal(e.JSON(c.v, c.td))
		require.NoError(t, err)
		got := decode(t, string(raw), c.td)
		again, err := json.Marshal(e.JSON(got, c.td))
		require.NoError(t, err)
		require.JSONEq(t, string(raw), string(again), c.td.Name)
	}
}
