package server

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/library"
)

// maxQueryBody bounds a request body; JSON escaping can inflate a 1 MiB text.
const maxQueryBody = 8 << 20

// queryBody is the body of saved-query create and update.
type queryBody struct {
	Name    string `json:"name"`
	Text    string `json:"text"`
	Global  bool   `json:"global"`
	Version int64  `json:"version"`
}

// library returns the signed-in user's library, or the local owner's when
// auth is off.
func (a *api) library(c *gin.Context) library.Library {
	var owner int64
	if u, ok := currentUser(c); ok {
		owner = u.ID
	}
	return library.Library{Store: a.store, Owner: owner}
}

func queryFail(c *gin.Context, err error) {
	var inv *library.InvalidNameError
	var conf *library.ConflictError
	switch {
	case errors.As(err, &inv):
		fail(c, http.StatusBadRequest, "invalid_name", inv.Reason, nil)
	case errors.Is(err, library.ErrTooLarge):
		fail(c, http.StatusRequestEntityTooLarge, "too_large", err.Error(), nil)
	case errors.Is(err, library.ErrQueryExists):
		fail(c, http.StatusConflict, "query_exists", "a query with this name already exists", nil)
	case errors.As(err, &conf):
		fail(c, http.StatusConflict, "query_conflict", "the query was changed elsewhere", conf.Current)
	case errors.Is(err, library.ErrQueryNotFound):
		fail(c, http.StatusNotFound, "query_not_found", "saved query not found", nil)
	default:
		fail(c, http.StatusInternalServerError, "store_failed", err.Error(), nil)
	}
}

func queryBodyOf(c *gin.Context) (queryBody, bool) {
	var in queryBody
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxQueryBody)
	if err := c.ShouldBindJSON(&in); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			queryFail(c, library.ErrTooLarge)
		} else {
			fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		}
		return in, false
	}
	return in, true
}

func (a *api) queriesList(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok || !a.seedStore(c) {
		return
	}
	items, err := a.library(c).List(p.Name, c.Query("q"))
	if err != nil {
		queryFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"queries": items})
}

func (a *api) queriesCreate(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok || !a.seedStore(c) {
		return
	}
	in, ok := queryBodyOf(c)
	if !ok {
		return
	}
	q, err := a.library(c).Create(p.Name, in.Name, in.Text, in.Global)
	if err != nil {
		queryFail(c, err)
		return
	}
	c.JSON(http.StatusCreated, q)
}

func (a *api) queriesGet(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok || !a.seedStore(c) {
		return
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	q, err := a.library(c).Get(p.Name, id)
	if err != nil {
		queryFail(c, err)
		return
	}
	c.JSON(http.StatusOK, q)
}

func (a *api) queriesUpdate(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok || !a.seedStore(c) {
		return
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	in, ok := queryBodyOf(c)
	if !ok {
		return
	}
	if in.Version < 1 {
		fail(c, http.StatusBadRequest, "bad_request", "version is required", nil)
		return
	}
	q, err := a.library(c).Update(p.Name, id, in.Version, in.Name, in.Text, in.Global)
	if err != nil {
		queryFail(c, err)
		return
	}
	c.JSON(http.StatusOK, q)
}

func (a *api) queriesDelete(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok || !a.seedStore(c) {
		return
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if err := a.library(c).Delete(p.Name, id); err != nil {
		queryFail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (a *api) queriesDuplicate(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok || !a.seedStore(c) {
		return
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	q, err := a.library(c).Duplicate(p.Name, id)
	if err != nil {
		queryFail(c, err)
		return
	}
	c.JSON(http.StatusCreated, q)
}
