package server

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/history"
	"github.com/0funct0ry/helenus/internal/schema"
	"github.com/0funct0ry/helenus/internal/store"
)

const (
	defaultChangesPage = 50
	maxChangesPage     = 200
)

// recordChange logs one UI-issued DDL statement with its reverse script (SPEC §9.15).
// Statements that are not DDL are skipped; a failure to log never fails the request.
func (a *api) recordChange(profile, currentKS, stmt string, before *schema.Snapshot, execErr error, took time.Duration) {
	info := history.Parse(stmt, currentKS)
	if info.Action == "" {
		return
	}
	c := store.Change{
		Profile: profile, Keyspace: info.Keyspace, ObjectKind: info.Kind, ObjectName: info.Name, Action: info.Action,
		Statement: history.MaskPassword(stmt), Status: "ok", DurationMS: took.Milliseconds(),
	}
	if execErr != nil {
		c.Status = "error"
		_, _, c.Error, _ = queryFailure(execErr, stmt)
	} else {
		c.Reverse, c.ReverseNote = history.Reverse(before, currentKS, stmt)
	}
	_, _ = a.store.AddChange(c)
}

// listSchemaChanges pages the profile's history, newest first.
func (a *api) listSchemaChanges(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok {
		return
	}
	limit := defaultChangesPage
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 {
		limit = min(v, maxChangesPage)
	}
	before, _ := strconv.ParseInt(c.Query("before"), 10, 64)
	items := []store.Change{}
	if a.store != nil {
		var err error
		if items, err = a.store.ListChanges(p.Name, limit, before, c.Query("q")); err != nil {
			fail(c, http.StatusInternalServerError, "store_failed", err.Error(), nil)
			return
		}
	}
	var next *int64
	if len(items) == limit {
		next = &items[len(items)-1].ID
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "next_before": next})
}

// clearSchemaChanges deletes the profile's history only.
func (a *api) clearSchemaChanges(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok {
		return
	}
	var n int64
	if a.store != nil {
		var err error
		if n, err = a.store.ClearChanges(p.Name); err != nil {
			fail(c, http.StatusInternalServerError, "store_failed", err.Error(), nil)
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"deleted": n})
}
