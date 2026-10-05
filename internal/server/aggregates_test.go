package server

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/exec"
	"github.com/0funct0ry/helenus/internal/schema"
)

func aggregateEnv(t *testing.T) *env {
	e := newEnv(t, seed)
	intT, _ := codec.Parse("int", "shop")
	e.fc.snap = &schema.Snapshot{Version: "4.1.5", Keyspaces: []schema.Keyspace{{
		Name: "shop",
		Tables: []schema.Table{{Keyspace: "shop", Name: "orders", Columns: []schema.Column{
			{Name: "id", Type: intT, CQL: "int"}, {Name: "note", Type: codec.TypeDesc{Name: "text"}, CQL: "text"}}}},
		Functions:  []schema.Function{{Keyspace: "shop", Name: "add2", ArgTypes: []string{"int", "int"}, ReturnType: "int", CalledOnNull: true}},
		Aggregates: []schema.Aggregate{{Keyspace: "shop", Name: "total", ArgTypes: []string{"int"}, StateFunc: "add2", StateType: "int", InitCond: "0"}},
	}}}
	return e
}

func TestAggregatesPreview(t *testing.T) {
	e := aggregateEnv(t)
	require.Equal(t, 409, e.do("POST", "/api/v1/p/local/aggregates/preview", `{}`).Code)
	e.do("POST", "/api/v1/p/local/connect", "")
	require.Equal(t, 400, e.do("POST", "/api/v1/p/local/aggregates/preview", `{bad`).Code)
	rec := e.do("POST", "/api/v1/p/local/aggregates/preview", `{"action":"drop","keyspace":"shop","name":"total","arg_types":["int"]}`)
	require.Equal(t, 200, rec.Code)
	require.Contains(t, rec.Body.String(), "DROP AGGREGATE shop.total(int);")
	rec = e.do("POST", "/api/v1/p/local/aggregates/preview", `{"action":"create","keyspace":"shop","name":"t2","arg_types":["int"],"sfunc":"add2","stype":"int","initcond":0}`)
	require.Contains(t, rec.Body.String(), "INITCOND 0")
}

func TestAggregatesCandidates(t *testing.T) {
	e := aggregateEnv(t)
	require.Equal(t, 409, e.do("POST", "/api/v1/p/local/aggregates/candidates", `{}`).Code)
	e.do("POST", "/api/v1/p/local/connect", "")
	require.Equal(t, 400, e.do("POST", "/api/v1/p/local/aggregates/candidates", `{bad`).Code)
	rec := e.do("POST", "/api/v1/p/local/aggregates/candidates", `{"keyspace":"shop","arg_types":["int"],"stype":"int"}`)
	require.Equal(t, 200, rec.Code)
	require.Contains(t, rec.Body.String(), `"ok":true`)
}

func TestAggregatesTest(t *testing.T) {
	e := aggregateEnv(t)
	url := "/api/v1/p/local/aggregates/test"
	require.Equal(t, 409, e.do("POST", url, `{}`).Code)
	e.do("POST", "/api/v1/p/local/connect", "")
	e.fc.queryRes = &exec.Result{Columns: []exec.Column{{Name: "result", Type: codec.TypeDesc{Name: "int"}}}, Rows: [][]any{{42}}}
	rec := e.do("POST", url, `{"keyspace":"shop","name":"total","signature":"total(int)","table":"orders","columns":["id"]}`)
	require.Equal(t, 200, rec.Code, rec.Body.String())
	require.Contains(t, rec.Body.String(), `"value":42`)
	require.Contains(t, rec.Body.String(), `"limit":1000`)
	require.Equal(t, "SELECT shop.total(id) AS result FROM shop.orders LIMIT 1000;", e.fc.queries[0].CQL)

	require.Equal(t, 404, e.do("POST", url, `{"keyspace":"shop","name":"x","signature":"x()","table":"orders","columns":[]}`).Code)
	require.Equal(t, 404, e.do("POST", url, `{"keyspace":"shop","name":"total","signature":"total(int)","table":"zzz","columns":["id"]}`).Code)
	require.Equal(t, 400, e.do("POST", url, `{"keyspace":"shop","name":"total","signature":"total(int)","table":"orders","columns":[]}`).Code)
	require.Equal(t, 400, e.do("POST", url, `{"keyspace":"shop","name":"total","signature":"total(int)","table":"orders","columns":["nope"]}`).Code)
	require.Equal(t, 400, e.do("POST", url, `{"keyspace":"shop","name":"total","signature":"total(int)","table":"orders","columns":["note"]}`).Code)
	e.fc.queryErr = errors.New("boom")
	require.Equal(t, 422, e.do("POST", url, `{"keyspace":"shop","name":"total","signature":"total(int)","table":"orders","columns":["id"]}`).Code)
}
