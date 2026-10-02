package server

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/config"
	"github.com/0funct0ry/helenus/internal/schema"
)

// connectedProfile resolves the profile and requires an open session (409 not_connected otherwise).
func (a *api) connectedProfile(c *gin.Context) (config.Profile, bool) {
	p, ok := a.profileOr404(c)
	if !ok {
		return p, false
	}
	if !a.conn.Connected(p.Name) {
		fail(c, http.StatusConflict, "not_connected", "profile is not connected; POST /connect first", nil)
		return p, false
	}
	return p, true
}

func (a *api) snapshot(c *gin.Context, refresh bool) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return
	}
	snap, err := a.conn.Schema(c.Request.Context(), p.Name, p, refresh)
	if err != nil {
		fail(c, http.StatusBadGateway, "schema_failed", err.Error(), nil)
		return
	}
	c.JSON(http.StatusOK, snap)
}

func (a *api) schema(c *gin.Context)        { a.snapshot(c, false) }
func (a *api) refreshSchema(c *gin.Context) { a.snapshot(c, true) }

// tableDetail returns one table with the full definition of each materialized view built on it.
func (a *api) tableDetail(c *gin.Context) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return
	}
	snap, err := a.conn.Schema(c.Request.Context(), p.Name, p, false)
	if err != nil {
		fail(c, http.StatusBadGateway, "schema_failed", err.Error(), nil)
		return
	}
	ks := snap.Keyspace(c.Param("ks"))
	if ks == nil {
		fail(c, http.StatusNotFound, "keyspace_not_found", "keyspace "+c.Param("ks")+" not found", nil)
		return
	}
	t := ks.Table(c.Param("t"))
	if t == nil {
		fail(c, http.StatusNotFound, "table_not_found", "table "+c.Param("t")+" not found in "+ks.Name, nil)
		return
	}
	views := []schema.View{}
	for _, n := range t.Views {
		if v := ks.View(n); v != nil {
			views = append(views, *v)
		}
	}
	c.JSON(http.StatusOK, gin.H{"keyspace": ks.Name, "table": t, "views": views})
}

var ddlKinds = map[string]schema.TargetKind{
	"keyspace": schema.KeyspaceT, "table": schema.TableT, "view": schema.ViewT, "type": schema.TypeT,
	"function": schema.FunctionT, "aggregate": schema.AggregateT, "index": schema.IndexT,
}

// ddl returns DESCRIBE output for one object: GET …/keyspaces/{ks}/ddl?object=table&name=t.
func (a *api) ddl(c *gin.Context) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return
	}
	kind, known := ddlKinds[c.DefaultQuery("object", "keyspace")]
	if !known {
		fail(c, http.StatusBadRequest, "bad_request", "object must be one of keyspace, table, view, type, function, aggregate, index", nil)
		return
	}
	t := schema.Target{Kind: kind, Keyspace: c.Param("ks"), Name: c.Query("name")}
	if kind == schema.KeyspaceT {
		t.Keyspace, t.Name = "", c.Param("ks")
	} else if t.Name == "" {
		fail(c, http.StatusBadRequest, "bad_request", "name is required", nil)
		return
	}
	out, err := a.conn.Describe(c.Request.Context(), p.Name, p, t)
	if err != nil {
		fail(c, http.StatusBadGateway, "describe_failed", err.Error(), nil)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ddl": out})
}
