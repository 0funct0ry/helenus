package server

import (
	"net/http"
	"unicode/utf16"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/complete"
	"github.com/0funct0ry/helenus/internal/schema"
)

type completeRequest struct {
	Text string `json:"text"`
	// Cursor is a UTF-16 code unit index into Text, as CodeMirror reports positions.
	Cursor   int    `json:"cursor"`
	Keyspace string `json:"keyspace"`
}

// complete answers a completion request (SPEC §10). It only reads the cached schema snapshot and
// never connects: an unconnected profile or a failed read yields keyword-only candidates, because
// completion must not block typing.
func (a *api) complete(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok {
		return
	}
	var in completeRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	var snap *schema.Snapshot
	if a.conn.Connected(p.Name) {
		if s, err := a.conn.Schema(c.Request.Context(), p.Name, p, false); err == nil {
			snap = s
		}
	}
	cursor := utf16ToByte(in.Text, in.Cursor)
	res := complete.Complete(c.Request.Context(), snap, in.Keyspace, in.Text, cursor)
	res.From = byteToUTF16(in.Text, res.From)
	c.JSON(http.StatusOK, res)
}

// utf16ToByte converts a UTF-16 code unit index into a byte offset of s, clamping to its length.
func utf16ToByte(s string, units int) int {
	if units <= 0 {
		return 0
	}
	n := 0
	for i, r := range s {
		if n >= units {
			return i
		}
		n += utf16.RuneLen(r)
	}
	return len(s)
}

// byteToUTF16 converts a byte offset of s into a UTF-16 code unit index.
func byteToUTF16(s string, off int) int {
	if off > len(s) {
		off = len(s)
	}
	n := 0
	for _, r := range s[:off] {
		n += utf16.RuneLen(r)
	}
	return n
}
