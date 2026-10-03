package server

import (
	"context"
	"errors"
	"net/http"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/trace"
)

// trace returns a shaped trace session (SPEC §11.3). Cassandra writes traces
// asynchronously, so the fetch polls for up to two seconds; a trace that is
// still incomplete is 404 trace_unavailable and the client offers a retry.
func (a *api) trace(c *gin.Context) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return
	}
	id := c.Param("id")
	if _, err := gocql.ParseUUID(id); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", "trace id is not a valid UUID", nil)
		return
	}
	tr, err := a.conn.Trace(c.Request.Context(), p.Name, p, id)
	switch {
	case errors.Is(err, trace.ErrNotAvailable):
		fail(c, http.StatusNotFound, "trace_unavailable", "Trace not yet available", nil)
	case errors.Is(err, context.Canceled):
		fail(c, 499, "cancelled", "request cancelled", nil)
	case err != nil:
		fail(c, http.StatusBadGateway, "trace_failed", err.Error(), nil)
	default:
		c.JSON(http.StatusOK, tr)
	}
}
