package server

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/0funct0ry/helenus/internal/exec"
	"github.com/0funct0ry/helenus/internal/trace"
)

const traceID = "5b0f8a40-9c9d-11f1-8b3a-0242ac120002"

func TestTraceRequiresConnection(t *testing.T) {
	e := newEnv(t, seed)
	rec := e.do("GET", "/api/v1/p/local/traces/"+traceID, "")
	require.Equal(t, 409, rec.Code)
}

func TestTraceReturnsShapedTrace(t *testing.T) {
	e := newEnv(t, seed)
	e.do("POST", "/api/v1/p/local/connect", "")
	e.fc.traceRes = trace.Shape(traceID, &trace.SessionRow{Coordinator: "10.0.0.1", Request: "Execute CQL3 query", DurationUS: 5000},
		[]trace.EventRow{{Activity: "Parsing", Source: "10.0.0.1", ElapsedUS: 10}})
	rec := e.do("GET", "/api/v1/p/local/traces/"+traceID, "")
	require.Equal(t, 200, rec.Code, rec.Body.String())
	var got trace.Trace
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
	require.Equal(t, 5.0, got.Summary.CoordinatorMS)
	require.Len(t, got.Lanes, 1)
	require.Equal(t, []string{traceID}, e.fc.traced)
}

func TestTraceErrors(t *testing.T) {
	e := newEnv(t, seed)
	e.do("POST", "/api/v1/p/local/connect", "")
	require.Equal(t, 400, e.do("GET", "/api/v1/p/local/traces/nope", "").Code)
	e.fc.traceErr = trace.ErrNotAvailable
	rec := e.do("GET", "/api/v1/p/local/traces/"+traceID, "")
	require.Equal(t, 404, rec.Code)
	require.Contains(t, rec.Body.String(), "trace_unavailable")
	e.fc.traceErr = errors.New("boom")
	require.Equal(t, 502, e.do("GET", "/api/v1/p/local/traces/"+traceID, "").Code)
}

func TestQueryPassesTrace(t *testing.T) {
	e := newEnv(t, seed)
	e.do("POST", "/api/v1/p/local/connect", "")
	e.fc.queryRes = &exec.Result{Kind: exec.KindVoid, TraceID: traceID}
	rec := e.do("POST", "/api/v1/p/local/query", `{"cql":"SELECT 1","trace":true}`)
	require.Equal(t, 200, rec.Code)
	require.True(t, e.fc.queries[0].Trace)
	require.Contains(t, rec.Body.String(), traceID)
}
