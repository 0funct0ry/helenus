package server

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/config"
)

func (a *api) profileOr404(c *gin.Context) (config.Profile, bool) {
	name := c.Param("profile")
	p, err := config.LoadProfile(a.configPath, name)
	var unknown *config.UnknownProfileError
	switch {
	case err == nil:
		return p, true
	case errors.As(err, &unknown):
		fail(c, http.StatusNotFound, "profile_not_found", err.Error(), nil)
	default:
		fail(c, http.StatusInternalServerError, "config_error", err.Error(), nil)
	}
	return p, false
}

// connect opens (or reuses) the session. On failure it re-runs the staged
// test so the UI can show which stage broke.
func (a *api) connect(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok {
		return
	}
	info, warnings, err := a.conn.Connect(c.Request.Context(), p.Name, p)
	if err != nil {
		detail := gin.H{}
		if res := a.conn.Test(c.Request.Context(), p); !res.OK {
			detail["failed_stage"], detail["stages"] = res.FailedStage, res.Stages
		}
		fail(c, http.StatusBadGateway, "connection_failed", err.Error(), detail)
		return
	}
	if warnings == nil {
		warnings = []string{}
	}
	c.JSON(http.StatusOK, gin.H{"profile": p.Name, "connected": true, "cluster": info, "warnings": warnings, "insecure_tls": p.TLS.Enabled && p.TLS.InsecureSkipVerify})
}

func (a *api) disconnect(c *gin.Context) {
	if _, ok := a.profileOr404(c); !ok {
		return
	}
	a.conn.Disconnect(c.Param("profile"))
	c.Status(http.StatusNoContent)
}

func (a *api) cluster(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok {
		return
	}
	if !a.conn.Connected(p.Name) {
		fail(c, http.StatusConflict, "not_connected", "profile is not connected; POST /connect first", nil)
		return
	}
	info, _, err := a.conn.Connect(c.Request.Context(), p.Name, p)
	if err != nil {
		fail(c, http.StatusBadGateway, "connection_failed", err.Error(), nil)
		return
	}
	c.JSON(http.StatusOK, info)
}
