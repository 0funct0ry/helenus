package server

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/advise"
	"github.com/0funct0ry/helenus/internal/schema"
)

// typesPreview validates a UDT create, add-field, rename-field or drop request against the cached
// schema and returns the CQL it would run (SPEC §9.11). Nothing is executed; the client sends the
// statement through /query once the user confirms. Validation problems are part of a 200 response
// so the form can show them next to the live preview.
func (a *api) typesPreview(c *gin.Context) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return
	}
	var in schema.TypeRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	snap, err := a.conn.Schema(c.Request.Context(), p.Name, p, false)
	if err != nil {
		fail(c, http.StatusBadGateway, "schema_failed", err.Error(), nil)
		return
	}
	plan := schema.PlanType(snap, in)
	plan.Explain = advise.ExplainType(in)
	c.JSON(http.StatusOK, plan)
}
