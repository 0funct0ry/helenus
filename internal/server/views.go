package server

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/advise"
	"github.com/0funct0ry/helenus/internal/schema"
)

// viewsPreview validates a materialized view create, alter or drop request against the cached schema and returns
// the statement (SPEC §9.19). Nothing is executed; the client sends the statement through /query.
func (a *api) viewsPreview(c *gin.Context) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return
	}
	var in schema.ViewRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	snap, err := a.conn.Schema(c.Request.Context(), p.Name, p, false)
	if err != nil {
		fail(c, http.StatusBadGateway, "schema_failed", err.Error(), nil)
		return
	}
	plan := schema.PlanView(snap, in)
	plan.Explain = advise.ExplainView(in)
	c.JSON(http.StatusOK, plan)
}
