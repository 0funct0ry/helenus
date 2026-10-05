package server

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/deps"
)

// deps returns what depends on an object and what it depends on (SPEC §9.14).
func (a *api) deps(c *gin.Context) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return
	}
	ref := deps.Ref{Kind: c.Query("kind"), Keyspace: c.Query("keyspace"), Name: c.Query("name"), Signature: c.Query("signature")}
	if ref.Kind == "" || ref.Name == "" {
		fail(c, http.StatusBadRequest, "bad_request", "kind and name are required", nil)
		return
	}
	snap, err := a.conn.Schema(c.Request.Context(), p.Name, p, false)
	if err != nil {
		fail(c, http.StatusBadGateway, "schema_failed", err.Error(), nil)
		return
	}
	idx := deps.Build(snap)
	if !idx.Exists(ref) {
		fail(c, http.StatusNotFound, "not_found", "object not found", nil)
		return
	}
	c.JSON(http.StatusOK, gin.H{"dependents": idx.Dependents(ref), "dependencies": idx.Dependencies(ref)})
}
