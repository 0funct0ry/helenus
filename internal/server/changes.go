package server

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/exec"
	"github.com/0funct0ry/helenus/internal/mutate"
)

type changesRequest struct {
	Keyspace          string          `json:"keyspace"`
	Table             string          `json:"table"`
	Consistency       string          `json:"consistency"`
	SerialConsistency string          `json:"serial_consistency"`
	Changes           []mutate.Change `json:"changes"`
}

// compileChanges reads the request and compiles its changes against the cached
// schema. It writes the error response itself and reports whether it did.
func (a *api) compileChanges(c *gin.Context) (changesRequest, []mutate.Statement, bool) {
	var in changesRequest
	p, ok := a.connectedProfile(c)
	if !ok {
		return in, nil, false
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return in, nil, false
	}
	if in.Keyspace == "" || in.Table == "" || len(in.Changes) == 0 {
		fail(c, http.StatusBadRequest, "bad_request", "keyspace, table and at least one change are required", nil)
		return in, nil, false
	}
	snap, err := a.conn.Schema(c.Request.Context(), p.Name, p, false)
	if err != nil {
		fail(c, http.StatusBadGateway, "schema_failed", err.Error(), nil)
		return in, nil, false
	}
	stmts, err := mutate.Compile(snap, in.Keyspace, in.Table, in.Changes)
	var ve *mutate.ValidationError
	var ro *mutate.ReadOnlyError
	switch {
	case err == nil:
		return in, stmts, true
	case errors.Is(err, mutate.ErrTableNotFound):
		fail(c, http.StatusNotFound, "table_not_found", "table "+in.Keyspace+"."+in.Table+" not found", nil)
	case errors.As(err, &ro):
		fail(c, http.StatusUnprocessableEntity, "read_only", ro.Reason, nil)
	case errors.As(err, &ve):
		fail(c, http.StatusUnprocessableEntity, "invalid_change", ve.Error(), gin.H{"errors": ve.Errors})
	default:
		fail(c, http.StatusInternalServerError, "compile_failed", err.Error(), nil)
	}
	return in, nil, false
}

// changesPreview compiles grid changes to CQL text without running them
// (SPEC §11.3).
func (a *api) changesPreview(c *gin.Context) {
	_, stmts, ok := a.compileChanges(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"statements": stmts})
}

type changeResult struct {
	Index       int            `json:"index"`
	Status      string         `json:"status"`
	ExecutedCQL string         `json:"executed_cql"`
	Error       *changeFailure `json:"error,omitempty"`
}

type changeFailure struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// changesApply compiles every change first, so an invalid change rejects the
// request before anything runs, then executes the statements sequentially and
// stops at the first failure (SPEC §9.9).
func (a *api) changesApply(c *gin.Context) {
	in, stmts, ok := a.compileChanges(c)
	if !ok {
		return
	}
	p, _ := a.profileOr404(c)
	run := func(ctx context.Context, req exec.Request) (*exec.Result, error) {
		return a.conn.Query(ctx, p.Name, p, req)
	}
	outcomes := mutate.Apply(c.Request.Context(), run, stmts, mutate.Options{
		Consistency: in.Consistency, SerialConsistency: in.SerialConsistency,
	})
	results := make([]changeResult, len(outcomes))
	applied, failedAt := 0, -1
	for i, o := range outcomes {
		results[i] = changeResult{Index: o.Index, Status: o.Status, ExecutedCQL: o.ExecutedCQL}
		switch o.Status {
		case mutate.StatusApplied:
			applied++
		case mutate.StatusFailed:
			failedAt = o.Index
			results[i].Error = describeFailure(o.Err, o.ExecutedCQL)
		}
	}
	c.JSON(http.StatusOK, gin.H{"results": results, "applied": applied, "failed_at": failedAt})
}

func describeFailure(err error, executed string) *changeFailure {
	if errors.Is(err, mutate.ErrNotApplied) {
		return &changeFailure{Code: "not_applied", Message: err.Error()}
	}
	_, code, msg, _ := queryFailure(err, executed)
	return &changeFailure{Code: code, Message: msg}
}
