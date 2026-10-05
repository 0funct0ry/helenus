package server

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/advise"
	"github.com/0funct0ry/helenus/internal/schema"
)

// triggersPreview validates a trigger create or drop request against the cached schema and returns
// the statement (SPEC §9.22). Nothing is executed; the client sends the statement through /query.
func (a *api) triggersPreview(c *gin.Context) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return
	}
	var in schema.TriggerRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	snap, err := a.conn.Schema(c.Request.Context(), p.Name, p, false)
	if err != nil {
		fail(c, http.StatusBadGateway, "schema_failed", err.Error(), nil)
		return
	}
	plan := schema.PlanTrigger(snap, in)
	plan.Explain = advise.ExplainTrigger(in)
	c.JSON(http.StatusOK, plan)
}
