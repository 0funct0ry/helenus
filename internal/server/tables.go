package server

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/advise"
	"github.com/0funct0ry/helenus/internal/schema"
)

// tablesPreview validates a table creation request against the cached schema and returns the
// CREATE TABLE statement (SPEC §9.13). Nothing is executed; the client sends the statement through
// /query. Validation problems are part of a 200 response so the wizard can show them live.
func (a *api) tablesPreview(c *gin.Context) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return
	}
	var in schema.TableRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	snap, err := a.conn.Schema(c.Request.Context(), p.Name, p, false)
	if err != nil {
		fail(c, http.StatusBadGateway, "schema_failed", err.Error(), nil)
		return
	}
	plan := schema.PlanTable(snap, in)
	plan.Explain = advise.ExplainTable(snap, in)
	if in.Action == "" || in.Action == "create" {
		facts := a.clusterFacts(c, p)
		fs := advise.AdviseTable(advise.DraftTable(in), facts)
		if ks := snap.Keyspace(in.Keyspace); ks != nil {
			fs = append(fs, advise.AdviseKeyspace(*ks, facts)...)
		}
		plan.Notes = withNotes(plan.Notes, fs)
	}
	c.JSON(http.StatusOK, plan)
}
