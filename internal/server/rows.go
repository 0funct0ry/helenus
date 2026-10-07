package server

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/config"
	"github.com/0funct0ry/helenus/internal/rowfmt"
)

// udtResolver returns the schema's UDT field resolver for a connected profile, or nil when the
// profile is not connected or its schema cannot be read (UDT cells then fail to decode).
func (a *api) udtResolver(c *gin.Context) codec.UDTFieldTypes {
	p, err := config.LoadProfile(a.configPath, c.Param("profile"))
	if err != nil || !a.conn.Connected(p.Name) {
		return nil
	}
	snap, err := a.conn.Schema(c.Request.Context(), p.Name, p, false)
	if err != nil || snap == nil {
		return nil
	}
	return snap.UDTFields
}

// rowsFormat renders grid rows in a Copy As format (SPEC §9.5.1).
func (a *api) rowsFormat(c *gin.Context) {
	var in rowfmt.Request
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	in.UDT = a.udtResolver(c)
	text, err := rowfmt.Format(in)
	var de *rowfmt.DisabledError
	switch {
	case err == nil:
		c.JSON(http.StatusOK, gin.H{"text": text})
	case errors.As(err, &de):
		fail(c, http.StatusUnprocessableEntity, "format_unavailable", de.Reason, nil)
	case errors.Is(err, rowfmt.ErrUnknownFormat):
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
	default:
		fail(c, http.StatusUnprocessableEntity, "format_failed", err.Error(), nil)
	}
}

// rowsAggregate computes the row aggregate figures (SPEC §9.5.1).
func (a *api) rowsAggregate(c *gin.Context) {
	var in rowfmt.AggregateRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	in.UDT = a.udtResolver(c)
	res, err := rowfmt.Aggregate(in)
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, "aggregate_failed", err.Error(), nil)
		return
	}
	c.JSON(http.StatusOK, res)
}
