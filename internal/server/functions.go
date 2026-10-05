package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/advise"
	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/exec"
	"github.com/0funct0ry/helenus/internal/schema"
)

// functionsPreview validates a function create, replace or drop request against the cached schema and
// returns the statement (SPEC §9.20). Nothing is executed; the client sends the statement through /query.
func (a *api) functionsPreview(c *gin.Context) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return
	}
	var in schema.FunctionRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	snap, err := a.conn.Schema(c.Request.Context(), p.Name, p, false)
	if err != nil {
		fail(c, http.StatusBadGateway, "schema_failed", err.Error(), nil)
		return
	}
	plan := schema.PlanFunction(snap, in)
	plan.Explain = advise.ExplainFunction(in)
	c.JSON(http.StatusOK, plan)
}

type invokeRequest struct {
	Keyspace  string            `json:"keyspace"`
	Name      string            `json:"name"`
	Signature string            `json:"signature"`
	Args      []json.RawMessage `json:"args"`
}

type invokeResult struct {
	Value     any            `json:"value"`
	Type      codec.TypeDesc `json:"type"`
	ElapsedMS float64        `json:"elapsed_ms"`
	CQL       string         `json:"cql"`
}

// functionsInvoke calls a UDF with literal arguments through `SELECT ks.f(...) FROM system.local`.
func (a *api) functionsInvoke(c *gin.Context) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return
	}
	var in invokeRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	snap, err := a.conn.Schema(c.Request.Context(), p.Name, p, false)
	if err != nil {
		fail(c, http.StatusBadGateway, "schema_failed", err.Error(), nil)
		return
	}
	var fn *schema.Function
	if ks := snap.Keyspace(in.Keyspace); ks != nil {
		for i, f := range ks.Functions {
			if f.Name == in.Name && f.Signature() == in.Signature {
				fn = &ks.Functions[i]
			}
		}
	}
	if fn == nil {
		fail(c, http.StatusNotFound, "not_found", fmt.Sprintf("function %s.%s not found", in.Keyspace, in.Signature), nil)
		return
	}
	if len(in.Args) != len(fn.ArgTypes) {
		fail(c, http.StatusBadRequest, "bad_request", fmt.Sprintf("%s takes %d arguments, got %d", fn.Name, len(fn.ArgTypes), len(in.Args)), nil)
		return
	}
	lits := make([]string, len(in.Args))
	for i, raw := range in.Args {
		td, err := codec.Parse(fn.ArgTypes[i], fn.Keyspace)
		if err != nil {
			fail(c, http.StatusInternalServerError, "invoke_failed", err.Error(), nil)
			return
		}
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.UseNumber()
		var v any
		if err := dec.Decode(&v); err != nil {
			fail(c, http.StatusBadRequest, "bad_request", fmt.Sprintf("argument %d: %v", i+1, err), nil)
			return
		}
		lit, err := jsonLiteral(v, td, snap)
		if err != nil {
			fail(c, http.StatusBadRequest, "bad_request", fmt.Sprintf("argument %d: %v", i+1, err), nil)
			return
		}
		lits[i] = lit
	}
	stmt := fmt.Sprintf("SELECT %s(%s) AS result FROM system.local;", schema.Ident(fn.Keyspace)+"."+schema.Ident(fn.Name), strings.Join(lits, ", "))
	start := time.Now()
	res, err := a.conn.Query(c.Request.Context(), p.Name, p, exec.Request{CQL: stmt})
	elapsed := float64(time.Since(start).Microseconds()) / 1000
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, "invoke_failed", err.Error(), nil)
		return
	}
	out := invokeResult{ElapsedMS: elapsed, CQL: stmt}
	if res != nil && len(res.Rows) > 0 && len(res.Rows[0]) > 0 {
		out.Value = res.Rows[0][0]
		if len(res.Columns) > 0 {
			out.Type = res.Columns[0].Type
		}
	}
	c.JSON(http.StatusOK, out)
}

// jsonLiteral renders a decoded JSON value as a CQL literal of type td.
func jsonLiteral(v any, td codec.TypeDesc, snap *schema.Snapshot) (string, error) {
	return schema.JSONLiteral(v, td, snap)
}
