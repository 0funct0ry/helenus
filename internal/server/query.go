package server

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/cql"
	"github.com/0funct0ry/helenus/internal/exec"
)

type queryRequest struct {
	CQL               string  `json:"cql"`
	Keyspace          string  `json:"keyspace"`
	Consistency       string  `json:"consistency"`
	SerialConsistency string  `json:"serial_consistency"`
	PageSize          int     `json:"page_size"`
	PageState         *string `json:"page_state"`
	AllowFiltering    bool    `json:"allow_filtering"`
	Trace             bool    `json:"trace"`
}

// query executes one statement (SPEC §11.3). Cancelling the HTTP request
// cancels the driver context.
func (a *api) query(c *gin.Context) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return
	}
	var in queryRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	stmts := cql.Split(in.CQL)
	if len(stmts) != 1 {
		fail(c, http.StatusBadRequest, "bad_request", "send exactly one statement per request", nil)
		return
	}
	req := exec.Request{
		CQL: stmts[0].Text, Keyspace: in.Keyspace, Consistency: in.Consistency, SerialConsistency: in.SerialConsistency,
		PageSize: in.PageSize, AllowFiltering: in.AllowFiltering, Trace: in.Trace,
	}
	if in.PageState != nil && *in.PageState != "" {
		ps, err := base64.StdEncoding.DecodeString(*in.PageState)
		if err != nil {
			fail(c, http.StatusBadRequest, "bad_request", "page_state is not valid base64", nil)
			return
		}
		req.PageState = ps
	}
	res, err := a.conn.Query(c.Request.Context(), p.Name, p, req)
	if err != nil {
		status, code, msg, detail := queryFailure(err, req.CQL)
		fail(c, status, code, msg, detail)
		return
	}
	c.JSON(http.StatusOK, res)
}

// queryFailure maps an execution error to the API error that describes it.
func queryFailure(err error, executedCQL string) (status int, code, message string, detail any) {
	var filt *exec.ErrFilteringRequired
	var reqErr gocql.RequestError
	switch {
	case errors.As(err, &filt):
		return http.StatusUnprocessableEntity, "filtering_required", filt.Message, gin.H{"executed_cql": executedCQL}
	case errors.Is(err, context.Canceled):
		return 499, "cancelled", "query cancelled", nil
	case errors.Is(err, context.DeadlineExceeded):
		return http.StatusGatewayTimeout, "timeout", "request timed out", nil
	case errors.As(err, &reqErr):
		return http.StatusBadRequest, "query_failed", reqErr.Message(), gin.H{"executed_cql": executedCQL}
	}
	return http.StatusBadGateway, "query_failed", err.Error(), gin.H{"executed_cql": executedCQL}
}

// split breaks editor text into statements with offsets (SPEC §7.1).
func (a *api) split(c *gin.Context) {
	if _, ok := a.profileOr404(c); !ok {
		return
	}
	var in struct {
		CQL string `json:"cql"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	c.JSON(http.StatusOK, gin.H{"statements": cql.Split(in.CQL)})
}
