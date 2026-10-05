package server

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/exec"
	"github.com/0funct0ry/helenus/internal/schema"
)

// aggregateTestLimit caps the rows an aggregate test reads.
const aggregateTestLimit = 1000

// aggregatesPreview validates an aggregate create, replace or drop request against the cached schema
// and returns the statement (SPEC §9.21). Nothing is executed.
func (a *api) aggregatesPreview(c *gin.Context) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return
	}
	var in schema.AggregateRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	snap, err := a.conn.Schema(c.Request.Context(), p.Name, p, false)
	if err != nil {
		fail(c, http.StatusBadGateway, "schema_failed", err.Error(), nil)
		return
	}
	c.JSON(http.StatusOK, schema.PlanAggregate(snap, in))
}

type candidatesRequest struct {
	Keyspace string   `json:"keyspace"`
	ArgTypes []string `json:"arg_types"`
	SType    string   `json:"stype"`
	Final    bool     `json:"final"`
}

// aggregatesCandidates lists the functions usable as SFUNC or FINALFUNC, with the reason for each that is not.
func (a *api) aggregatesCandidates(c *gin.Context) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return
	}
	var in candidatesRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	snap, err := a.conn.Schema(c.Request.Context(), p.Name, p, false)
	if err != nil {
		fail(c, http.StatusBadGateway, "schema_failed", err.Error(), nil)
		return
	}
	c.JSON(http.StatusOK, gin.H{"candidates": schema.AggregateCandidates(snap, in.Keyspace, in.ArgTypes, in.SType, in.Final)})
}

type aggregateTestRequest struct {
	Keyspace  string   `json:"keyspace"`
	Name      string   `json:"name"`
	Signature string   `json:"signature"`
	Table     string   `json:"table"`
	Columns   []string `json:"columns"`
}

type aggregateTestResult struct {
	Value     any            `json:"value"`
	Type      codec.TypeDesc `json:"type"`
	ElapsedMS float64        `json:"elapsed_ms"`
	CQL       string         `json:"cql"`
	Limit     int            `json:"limit"`
}

// aggregatesTest runs `SELECT ks.agg(cols) FROM ks.table LIMIT 1000` after checking that the columns exist
// and match the aggregate's argument types.
func (a *api) aggregatesTest(c *gin.Context) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return
	}
	var in aggregateTestRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	snap, err := a.conn.Schema(c.Request.Context(), p.Name, p, false)
	if err != nil {
		fail(c, http.StatusBadGateway, "schema_failed", err.Error(), nil)
		return
	}
	var ag *schema.Aggregate
	ks := snap.Keyspace(in.Keyspace)
	if ks != nil {
		for i, x := range ks.Aggregates {
			if x.Name == in.Name && x.Signature() == in.Signature {
				ag = &ks.Aggregates[i]
			}
		}
	}
	if ag == nil {
		fail(c, http.StatusNotFound, "not_found", fmt.Sprintf("aggregate %s.%s not found", in.Keyspace, in.Signature), nil)
		return
	}
	var cols []schema.Column
	if t := ks.Table(in.Table); t != nil {
		cols = t.Columns
	} else if v := ks.View(in.Table); v != nil {
		cols = v.Columns
	} else {
		fail(c, http.StatusNotFound, "not_found", fmt.Sprintf("table %s.%s not found", in.Keyspace, in.Table), nil)
		return
	}
	if len(in.Columns) != len(ag.ArgTypes) {
		fail(c, http.StatusBadRequest, "bad_request", fmt.Sprintf("%s takes %d columns, got %d", ag.Name, len(ag.ArgTypes), len(in.Columns)), nil)
		return
	}
	names := make([]string, len(in.Columns))
	for i, name := range in.Columns {
		var col *schema.Column
		for j := range cols {
			if cols[j].Name == name {
				col = &cols[j]
			}
		}
		if col == nil {
			fail(c, http.StatusBadRequest, "bad_request", fmt.Sprintf("column %s not found in %s", name, in.Table), nil)
			return
		}
		if !schema.SameType(ks.Name, col.Type.String(), ag.ArgTypes[i]) {
			fail(c, http.StatusBadRequest, "bad_request", fmt.Sprintf("column %s is %s but argument %d is %s", name, col.Type.String(), i+1, ag.ArgTypes[i]), nil)
			return
		}
		names[i] = schema.Ident(name)
	}
	stmt := fmt.Sprintf("SELECT %s.%s(%s) AS result FROM %s.%s LIMIT %d;", schema.Ident(ag.Keyspace), schema.Ident(ag.Name),
		strings.Join(names, ", "), schema.Ident(ag.Keyspace), schema.Ident(in.Table), aggregateTestLimit)
	start := time.Now()
	res, err := a.conn.Query(c.Request.Context(), p.Name, p, exec.Request{CQL: stmt})
	elapsed := float64(time.Since(start).Microseconds()) / 1000
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, "test_failed", err.Error(), nil)
		return
	}
	out := aggregateTestResult{ElapsedMS: elapsed, CQL: stmt, Limit: aggregateTestLimit}
	if res != nil && len(res.Rows) > 0 && len(res.Rows[0]) > 0 {
		out.Value = res.Rows[0][0]
		if len(res.Columns) > 0 {
			out.Type = res.Columns[0].Type
		}
	}
	c.JSON(http.StatusOK, out)
}
