package server

import (
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/exec"
	"github.com/0funct0ry/helenus/internal/schema"
)

func functionEnv(t *testing.T) *env {
	e := newEnv(t, seed)
	e.fc.snap = &schema.Snapshot{Version: "4.1.5", Keyspaces: []schema.Keyspace{{
		Name: "shop",
		Functions: []schema.Function{{Keyspace: "shop", Name: "add_tax", ArgNames: []string{"a", "r"},
			ArgTypes: []string{"decimal", "decimal"}, ReturnType: "decimal", Language: "java", Body: "return a;"}},
	}}}
	return e
}

func TestFunctionsPreview(t *testing.T) {
	e := functionEnv(t)
	require.Equal(t, 409, e.do("POST", "/api/v1/p/local/functions/preview", `{}`).Code)
	e.do("POST", "/api/v1/p/local/connect", "")
	require.Equal(t, 400, e.do("POST", "/api/v1/p/local/functions/preview", `{bad`).Code)
	rec := e.do("POST", "/api/v1/p/local/functions/preview", `{"action":"drop","keyspace":"shop","name":"add_tax","args":[{"name":"a","type":"decimal"},{"name":"r","type":"decimal"}]}`)
	require.Equal(t, 200, rec.Code)
	require.Contains(t, rec.Body.String(), "DROP FUNCTION shop.add_tax(decimal, decimal);")
	rec = e.do("POST", "/api/v1/p/local/functions/preview", `{"action":"drop","keyspace":"zzz","name":"f"}`)
	require.Equal(t, 200, rec.Code)
	require.Contains(t, rec.Body.String(), "not found")
}

func TestFunctionsInvoke(t *testing.T) {
	e := functionEnv(t)
	require.Equal(t, 409, e.do("POST", "/api/v1/p/local/functions/invoke", `{}`).Code)
	e.do("POST", "/api/v1/p/local/connect", "")
	e.fc.queryRes = &exec.Result{Columns: []exec.Column{{Name: "result", Type: codec.TypeDesc{Name: "decimal"}}}, Rows: [][]any{{"120.0"}}}
	rec := e.do("POST", "/api/v1/p/local/functions/invoke", `{"keyspace":"shop","name":"add_tax","signature":"add_tax(decimal, decimal)","args":[100,0.2]}`)
	require.Equal(t, 200, rec.Code, rec.Body.String())
	require.Contains(t, rec.Body.String(), `"value":"120.0"`)
	require.Equal(t, "SELECT shop.add_tax(100, 0.2) AS result FROM system.local;", e.fc.queries[0].CQL)

	require.Equal(t, 404, e.do("POST", "/api/v1/p/local/functions/invoke", `{"keyspace":"shop","name":"x","signature":"x()","args":[]}`).Code)
	require.Equal(t, 400, e.do("POST", "/api/v1/p/local/functions/invoke", `{"keyspace":"shop","name":"add_tax","signature":"add_tax(decimal, decimal)","args":[1]}`).Code)
	e.fc.queryErr = errors.New("boom")
	rec = e.do("POST", "/api/v1/p/local/functions/invoke", `{"keyspace":"shop","name":"add_tax","signature":"add_tax(decimal, decimal)","args":[1,2]}`)
	require.Equal(t, 422, rec.Code)
	require.True(t, strings.Contains(rec.Body.String(), "boom"))
}

func TestJSONLiteral(t *testing.T) {
	list, _ := codec.Parse("list<text>", "shop")
	l, err := jsonLiteral([]any{"a'b", "c"}, list, &schema.Snapshot{})
	require.NoError(t, err)
	require.Equal(t, "['a''b', 'c']", l)
}

func TestJSONLiteralRejectsInjection(t *testing.T) {
	dec, _ := codec.Parse("decimal", "shop")
	_, err := jsonLiteral("1) FROM system.local; DROP TABLE x; --", dec, &schema.Snapshot{})
	require.Error(t, err)
	l, err := jsonLiteral("1.5", dec, &schema.Snapshot{})
	require.NoError(t, err)
	require.Equal(t, "1.5", l)
}
