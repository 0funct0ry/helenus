package server

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/schema"
)

// systemDocs serves the embedded catalog of system keyspace descriptions (SPEC §9.24).
// It needs no connection: the catalog ships in the binary.
func (a *api) systemDocs(c *gin.Context) {
	c.JSON(http.StatusOK, schema.SystemDocs())
}
