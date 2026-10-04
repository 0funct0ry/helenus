package server

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/schema"
)

// keyspacesPreview validates a keyspace creation request against the cached schema and returns the
// CREATE KEYSPACE statement (SPEC §9.3). Nothing is executed; the client sends the statement through
// /query. Validation problems are part of a 200 response so the form can show them live.
func (a *api) keyspacesPreview(c *gin.Context) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return
	}
	var in schema.KeyspaceRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	snap, err := a.conn.Schema(c.Request.Context(), p.Name, p, false)
	if err != nil {
		fail(c, http.StatusBadGateway, "schema_failed", err.Error(), nil)
		return
	}
	var dcNodes map[string]int
	if info, _, err := a.conn.Connect(c.Request.Context(), p.Name, p); err == nil {
		dcNodes = map[string]int{}
		for _, n := range info.Nodes {
			dcNodes[n.DC]++
		}
	}
	c.JSON(http.StatusOK, schema.PlanKeyspace(snap, in, dcNodes))
}
