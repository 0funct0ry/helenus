package server

import (
	"mime"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/auth"
	"github.com/0funct0ry/helenus/internal/store"
)

const (
	sessionCookie = "helenus_session"
	userKey       = "helenus.user"
)

// multipartRoutes are the only endpoints that accept multipart bodies (SPEC §12.2).
func isMultipartRoute(path string) bool {
	return path == "/api/v1/profiles/astra/bundle" || (strings.HasPrefix(path, "/api/v1/p/") && strings.HasSuffix(path, "/import/upload"))
}

// csrf requires application/json on mutating requests; the two upload endpoints take
// multipart plus the X-Helenus-Request header, which a cross-site form cannot set.
func csrf() gin.HandlerFunc {
	return func(c *gin.Context) {
		switch c.Request.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			c.Next()
			return
		}
		mt, _, _ := mime.ParseMediaType(c.GetHeader("Content-Type"))
		if isMultipartRoute(c.Request.URL.Path) {
			if mt != "multipart/form-data" || c.GetHeader("X-Helenus-Request") != "1" {
				fail(c, http.StatusBadRequest, "invalid_request", "upload requires multipart/form-data and the X-Helenus-Request: 1 header", nil)
				return
			}
		} else if mt != "application/json" {
			fail(c, http.StatusUnsupportedMediaType, "invalid_request", "Content-Type must be application/json", nil)
			return
		}
		c.Next()
	}
}

// requireAuth rejects requests without a valid session and silently reissues the
// cookie when little lifetime remains.
func requireAuth(svc *auth.Service, secure bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		tok, err := c.Cookie(sessionCookie)
		if err != nil {
			fail(c, http.StatusUnauthorized, "unauthorized", "Sign in to continue.", nil)
			return
		}
		sess, err := svc.Verify(tok)
		if err != nil {
			clearCookie(c, secure)
			fail(c, http.StatusUnauthorized, "unauthorized", "Your session has expired. Sign in again.", nil)
			return
		}
		if svc.NeedsRefresh(sess) {
			if fresh, exp, err := svc.Issue(sess.User); err == nil {
				setCookie(c, fresh, exp, secure)
			}
		}
		c.Set(userKey, sess.User)
		c.Next()
	}
}

func currentUser(c *gin.Context) (store.User, bool) {
	v, ok := c.Get(userKey)
	if !ok {
		return store.User{}, false
	}
	u, ok := v.(store.User)
	return u, ok
}

func setCookie(c *gin.Context, token string, exp time.Time, secure bool) {
	http.SetCookie(c.Writer, &http.Cookie{Name: sessionCookie, Value: token, Path: "/", Expires: exp, HttpOnly: true, Secure: secure, SameSite: http.SameSiteStrictMode})
}

func clearCookie(c *gin.Context, secure bool) {
	http.SetCookie(c.Writer, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: secure, SameSite: http.SameSiteStrictMode})
}
