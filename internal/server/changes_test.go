package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/exec"
	"github.com/0funct0ry/helenus/internal/mutate"
	"github.com/0funct0ry/helenus/internal/schema"
)

func changesEnv(t *testing.T) *env {
	e := newEnv(t, seed)
	typ := func(s string) codec.TypeDesc {
		td, err := codec.Parse(s, "payments")
		require.NoError(t, err)
		return td
	}
	e.fc.snap = &schema.Snapshot{Version: "5.0", Keyspaces: []schema.Keyspace{
		{Name: "payments",
			Tables: []schema.Table{{Keyspace: "payments", Name: "t", Columns: []schema.Column{
				{Name: "id", Type: typ("uuid"), Kind: schema.KindPartition, Position: 1},
				{Name: "status", Type: typ("text"), Kind: schema.KindRegular},
				{Name: "tags", Type: typ("set<text>"), Kind: schema.KindRegular},
			}}},
			Views: []schema.View{{Keyspace: "payments", Name: "v", BaseTable: "t"}}},
		{Name: "system", System: true, Tables: []schema.Table{{Keyspace: "system", Name: "local"}}},
	}}
	e.do("POST", "/api/v1/p/local/connect", "")
	return e
}

const rowID = `"7c9e6679-7425-40de-944b-e07fc1f90ae7"`

func changeBody(changes string) string {
	return `{"keyspace":"payments","table":"t","consistency":"LOCAL_QUORUM","changes":` + changes + `}`
}

const twoChanges = `[
	{"kind":"set_cell","key":{"id":` + rowID + `},"column":"status","value":"done"},
	{"kind":"set_add","key":{"id":` + rowID + `},"column":"tags","value":["vip"]}]`

func TestChangesRequireConnection(t *testing.T) {
	e := newEnv(t, seed)
	for _, path := range []string{"/changes/preview", "/changes/apply"} {
		rec := e.do("POST", "/api/v1/p/local"+path, changeBody(twoChanges))
		require.Equal(t, http.StatusConflict, rec.Code, path)
	}
}

func TestChangesPreview(t *testing.T) {
	e := changesEnv(t)
	rec := e.do("POST", "/api/v1/p/local/changes/preview", changeBody(twoChanges))
	require.Equal(t, 200, rec.Code, rec.Body.String())
	var got struct {
		Statements []struct {
			Index   int    `json:"index"`
			CQL     string `json:"cql"`
			Preview string `json:"preview"`
		} `json:"statements"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
	require.Len(t, got.Statements, 2)
	require.Equal(t, "UPDATE payments.t SET tags = tags + ? WHERE id = ?;", got.Statements[1].CQL)
	require.Contains(t, got.Statements[1].Preview, "tags + {'vip'}")
	require.Empty(t, e.fc.queries, "preview must not execute anything")
}

func TestChangesRejections(t *testing.T) {
	e := changesEnv(t)
	post := func(body string) (int, string) {
		rec := e.do("POST", "/api/v1/p/local/changes/apply", body)
		return rec.Code, rec.Body.String()
	}
	code, body := post(`{"keyspace":"payments","table":"t","changes":[]}`)
	require.Equal(t, 400, code, body)

	code, body = post(`{"keyspace":"payments","table":"nope","changes":` + twoChanges + `}`)
	require.Equal(t, 404, code, body)
	require.Contains(t, body, "table_not_found")

	code, body = post(`{"keyspace":"payments","table":"v","changes":` + twoChanges + `}`)
	require.Equal(t, 422, code, body)
	require.Contains(t, body, "read_only")

	code, body = post(`{"keyspace":"system","table":"local","changes":` + twoChanges + `}`)
	require.Equal(t, 422, code, body)
	require.Contains(t, body, "system keyspaces")

	code, body = post(changeBody(`[
		{"kind":"set_cell","key":{"id":` + rowID + `},"column":"status","value":"ok"},
		{"kind":"set_cell","key":{"id":` + rowID + `},"column":"id","value":"x"}]`))
	require.Equal(t, 422, code, body)
	require.Contains(t, body, "invalid_change")
	require.Contains(t, body, `"index":1`)
	require.Empty(t, e.fc.queries, "an invalid change must stop the whole request before anything runs")
}

func TestChangesApply(t *testing.T) {
	e := changesEnv(t)
	e.fc.queryRes = &exec.Result{Kind: exec.KindVoid}
	rec := e.do("POST", "/api/v1/p/local/changes/apply", changeBody(twoChanges))
	require.Equal(t, 200, rec.Code, rec.Body.String())
	var got struct {
		Applied  int `json:"applied"`
		FailedAt int `json:"failed_at"`
		Results  []struct {
			Status      string `json:"status"`
			ExecutedCQL string `json:"executed_cql"`
		} `json:"results"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
	require.Equal(t, 2, got.Applied)
	require.Equal(t, -1, got.FailedAt)
	require.Equal(t, "applied", got.Results[1].Status)

	require.Len(t, e.fc.queries, 2)
	q := e.fc.queries[0]
	require.Equal(t, "UPDATE payments.t SET status = ? WHERE id = ?;", q.CQL)
	require.Equal(t, "LOCAL_QUORUM", q.Consistency)
	require.Len(t, q.Args, 2)
	require.Equal(t, "done", q.Args[0])
}

func TestChangesApplyStopsAtFirstFailure(t *testing.T) {
	e := changesEnv(t)
	e.fc.queryRes = &exec.Result{Kind: exec.KindVoid}
	e.fc.queryErr, e.fc.failOn = errors.New("write timeout"), 1
	rec := e.do("POST", "/api/v1/p/local/changes/apply", changeBody(twoChanges))
	require.Equal(t, 200, rec.Code, rec.Body.String())
	var got struct {
		Applied  int `json:"applied"`
		FailedAt int `json:"failed_at"`
		Results  []struct {
			Status string `json:"status"`
			Error  *struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		} `json:"results"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
	require.Equal(t, 0, got.Applied)
	require.Equal(t, 0, got.FailedAt)
	require.Equal(t, mutate.StatusFailed, got.Results[0].Status)
	require.Equal(t, "write timeout", got.Results[0].Error.Message)
	require.Equal(t, mutate.StatusPending, got.Results[1].Status)
	require.Len(t, e.fc.queries, 1, "the second change must not run")
}

func TestChangesApplyReportsDeclinedInsert(t *testing.T) {
	e := changesEnv(t)
	e.fc.queryRes = &exec.Result{Kind: exec.KindRows, Columns: []exec.Column{{Name: "[applied]"}}, Rows: [][]any{{false}}}
	body := changeBody(`[{"kind":"insert_row","if_not_exists":true,"values":{"id":` + rowID + `}}]`)
	rec := e.do("POST", "/api/v1/p/local/changes/apply", body)
	require.Equal(t, 200, rec.Code, rec.Body.String())
	require.Contains(t, rec.Body.String(), "not_applied")
	require.Contains(t, rec.Body.String(), `"failed_at":0`)
}
