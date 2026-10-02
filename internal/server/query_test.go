package server

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/0funct0ry/helenus/internal/exec"
)

func TestQueryRequiresConnection(t *testing.T) {
	e := newEnv(t, seed)
	rec := e.do("POST", "/api/v1/p/local/query", `{"cql":"SELECT 1"}`)
	require.Equal(t, http.StatusConflict, rec.Code)
}

func TestQueryRuns(t *testing.T) {
	e := newEnv(t, seed)
	e.do("POST", "/api/v1/p/local/connect", "")
	e.fc.queryRes = &exec.Result{Kind: exec.KindRows, Rows: [][]any{{"a"}}, Columns: []exec.Column{{Name: "x"}}}
	ps := base64.StdEncoding.EncodeToString([]byte{1, 2})
	body := `{"cql":"SELECT * FROM t; -- hi","keyspace":"ks","consistency":"QUORUM","page_size":50,"page_state":"` + ps + `","allow_filtering":true}`
	rec := e.do("POST", "/api/v1/p/local/query", body)
	require.Equal(t, 200, rec.Code, rec.Body.String())
	var got exec.Result
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
	require.Equal(t, exec.KindRows, got.Kind)
	r := e.fc.queries[0]
	require.Equal(t, "SELECT * FROM t;", r.CQL)
	require.Equal(t, "ks", r.Keyspace)
	require.Equal(t, 50, r.PageSize)
	require.Equal(t, []byte{1, 2}, r.PageState)
	require.True(t, r.AllowFiltering)
}

func TestQueryErrors(t *testing.T) {
	e := newEnv(t, seed)
	e.do("POST", "/api/v1/p/local/connect", "")
	rec := e.do("POST", "/api/v1/p/local/query", `{"cql":"SELECT 1; SELECT 2;"}`)
	require.Equal(t, 400, rec.Code)
	rec = e.do("POST", "/api/v1/p/local/query", `{"cql":"SELECT 1","page_state":"!!"}`)
	require.Equal(t, 400, rec.Code)
	e.fc.queryErr = &exec.ErrFilteringRequired{Message: "needs ALLOW FILTERING"}
	rec = e.do("POST", "/api/v1/p/local/query", `{"cql":"SELECT * FROM t"}`)
	require.Equal(t, 422, rec.Code)
	require.Contains(t, rec.Body.String(), "filtering_required")
	e.fc.queryErr = errors.New("boom")
	rec = e.do("POST", "/api/v1/p/local/query", `{"cql":"SELECT * FROM t"}`)
	require.Equal(t, 502, rec.Code)
}

func TestSplit(t *testing.T) {
	e := newEnv(t, seed)
	rec := e.do("POST", "/api/v1/p/local/split", `{"cql":"SELECT 1; SELECT 'a;b'"}`)
	require.Equal(t, 200, rec.Code)
	require.True(t, strings.Contains(rec.Body.String(), `"complete":false`))
	require.Contains(t, rec.Body.String(), `"start":10`)
}
