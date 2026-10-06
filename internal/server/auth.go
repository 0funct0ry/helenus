package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/auth"
)

type authAPI struct {
	svc    *auth.Service
	secure bool
}

func (a *authAPI) login(c *gin.Context) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, http.StatusBadRequest, "invalid_request", "username and password are required", nil)
		return
	}
	u, err := a.svc.Login(c.ClientIP(), body.Username, body.Password)
	switch {
	case errors.Is(err, auth.ErrRateLimited):
		fail(c, http.StatusTooManyRequests, "rate_limited", err.Error(), nil)
		return
	case errors.Is(err, auth.ErrInvalidCredentials):
		fail(c, http.StatusUnauthorized, "invalid_credentials", err.Error(), nil)
		return
	case err != nil:
		fail(c, http.StatusInternalServerError, "internal", "sign-in failed", nil)
		return
	}
	tok, exp, err := a.svc.Issue(u)
	if err != nil {
		fail(c, http.StatusInternalServerError, "internal", "sign-in failed", nil)
		return
	}
	setCookie(c, tok, exp, a.secure)
	c.JSON(http.StatusOK, gin.H{"username": u.Username})
}

func (a *authAPI) logout(c *gin.Context) {
	if u, ok := currentUser(c); ok {
		_ = a.svc.Revoke(u.ID)
	}
	clearCookie(c, a.secure)
	c.Status(http.StatusNoContent)
}

func (a *authAPI) me(c *gin.Context) {
	u, _ := currentUser(c)
	c.JSON(http.StatusOK, gin.H{"username": u.Username})
}

// uiState persists a user's open tabs per profile; without auth there is no user, so it is a no-op.
type uiStateAPI struct{ a *api }

func (s uiStateAPI) get(c *gin.Context) {
	u, ok := currentUser(c)
	if !ok || s.a.store == nil {
		c.JSON(http.StatusOK, gin.H{"state": nil})
		return
	}
	v, err := s.a.store.UIState(u.ID, c.Param("profile"))
	if err != nil {
		fail(c, http.StatusInternalServerError, "internal", "could not read saved tabs", nil)
		return
	}
	var state any
	if v != "" {
		_ = json.Unmarshal([]byte(v), &state)
	}
	c.JSON(http.StatusOK, gin.H{"state": state})
}

func (s uiStateAPI) put(c *gin.Context) {
	u, ok := currentUser(c)
	if !ok || s.a.store == nil {
		c.Status(http.StatusNoContent)
		return
	}
	raw, err := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20))
	if err != nil || !json.Valid(raw) {
		fail(c, http.StatusBadRequest, "invalid_request", "body must be JSON", nil)
		return
	}
	if err := s.a.store.PutUIState(u.ID, c.Param("profile"), string(raw)); err != nil {
		fail(c, http.StatusInternalServerError, "internal", "could not save tabs", nil)
		return
	}
	c.Status(http.StatusNoContent)
}
