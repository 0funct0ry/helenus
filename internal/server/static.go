package server

import (
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	cacheImmutable = "public, max-age=31536000, immutable"
	cacheNone      = "no-cache"
)

// staticHandler serves the embedded app. Hashed files under assets/ are
// immutable, index.html is no-cache, and unknown non-API paths fall back to
// index.html for client-side routing (SPEC §11.4).
func staticHandler(assets fs.FS) gin.HandlerFunc {
	return func(c *gin.Context) {
		p := c.Request.URL.Path
		if p == "/api" || strings.HasPrefix(p, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": gin.H{"code": "not_found", "message": "no such API route"}})
			return
		}
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			c.Status(http.StatusMethodNotAllowed)
			return
		}

		name := strings.TrimPrefix(path.Clean("/"+p), "/")
		if name != "" && name != "index.html" {
			if data, err := fs.ReadFile(assets, name); err == nil {
				cache := cacheNone
				if strings.HasPrefix(name, "assets/") {
					cache = cacheImmutable
				}
				serve(c, name, data, cache)
				return
			}
		}
		data, err := fs.ReadFile(assets, "index.html")
		if err != nil {
			c.String(http.StatusServiceUnavailable, "web UI not built: run `make build`")
			return
		}
		serve(c, "index.html", data, cacheNone)
	}
}

func serve(c *gin.Context, name string, data []byte, cache string) {
	ctype := mime.TypeByExtension(path.Ext(name))
	if ctype == "" {
		ctype = http.DetectContentType(data)
	}
	c.Header("Cache-Control", cache)
	c.Data(http.StatusOK, ctype, data)
}
