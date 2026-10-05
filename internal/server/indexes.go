package server

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/advise"
	"github.com/0funct0ry/helenus/internal/schema"
)

// indexesPreview validates an index create or drop request against the cached schema and returns
// the statement (SPEC §9.18). Nothing is executed; the client sends the statement through /query.
func (a *api) indexesPreview(c *gin.Context) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return
	}
	var in schema.IndexRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	snap, err := a.conn.Schema(c.Request.Context(), p.Name, p, false)
	if err != nil {
		fail(c, http.StatusBadGateway, "schema_failed", err.Error(), nil)
		return
	}
	plan := schema.PlanIndex(snap, in)
	plan.Explain = advise.ExplainIndex(snap, in)
	if in.Action != schema.IndexDrop {
		plan.Notes = withNotes(plan.Notes, advise.AdviseIndex(snap, in, a.clusterFacts(c, p)))
	}
	c.JSON(http.StatusOK, plan)
}
