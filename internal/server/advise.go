package server

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/advise"
	"github.com/0funct0ry/helenus/internal/config"
)

// clusterFacts reads the node and datacenter counts the advisor rules need. Unknown counts are zero,
// which switches off the rules that depend on them.
func (a *api) clusterFacts(c *gin.Context, p config.Profile) advise.ClusterFacts {
	info, _, err := a.conn.Connect(c.Request.Context(), p.Name, p)
	if err != nil || info == nil {
		return advise.ClusterFacts{}
	}
	return advise.ClusterFacts{Nodes: info.NodeCount, DCs: len(info.Datacenters)}
}

// adviseGet returns data-model findings for one table, or for a whole keyspace when table is omitted
// (SPEC §9.25).
func (a *api) adviseGet(c *gin.Context) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return
	}
	ksName, table := c.Query("keyspace"), c.Query("table")
	if ksName == "" {
		fail(c, http.StatusBadRequest, "bad_request", "keyspace is required", nil)
		return
	}
	snap, err := a.conn.Schema(c.Request.Context(), p.Name, p, false)
	if err != nil {
		fail(c, http.StatusBadGateway, "schema_failed", err.Error(), nil)
		return
	}
	ks := snap.Keyspace(ksName)
	if ks == nil {
		fail(c, http.StatusNotFound, "not_found", "Keyspace "+ksName+" not found", nil)
		return
	}
	facts := a.clusterFacts(c, p)
	var findings []advise.Finding
	if table == "" {
		findings = advise.AdviseKeyspaceAll(*ks, facts)
	} else {
		t := ks.Table(table)
		if t == nil {
			fail(c, http.StatusNotFound, "not_found", "Table "+ksName+"."+table+" not found", nil)
			return
		}
		if !ks.System {
			findings = advise.AdviseTable(*t, facts)
		}
	}
	if findings == nil {
		findings = []advise.Finding{}
	}
	c.JSON(http.StatusOK, gin.H{"findings": findings})
}

// withNotes appends advisor notes to a plan's notes.
func withNotes(notes []string, fs []advise.Finding) []string {
	return append(notes, advise.Notes(fs)...)
}
