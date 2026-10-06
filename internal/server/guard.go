package server

import (
	"fmt"
	"net"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// IsLoopbackAddr reports whether a listen address binds only the loopback interface.
// An empty host (":4042") and unspecified addresses bind every interface.
func IsLoopbackAddr(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		host = addr
	}
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}

// CheckBind refuses a non-loopback bind without auth (SPEC §12.1) and names the exact fix.
func CheckBind(addr string, auth bool) error {
	if auth || IsLoopbackAddr(addr) {
		return nil
	}
	return fmt.Errorf("refusing to listen on %s: it is not a loopback address and sign-in is off.\n"+
		"Anyone who can reach this address could run CQL against your clusters. To fix it:\n"+
		"  1. helenus user add <username>\n"+
		"  2. start with --auth (or set HELENUS_AUTH=true, or ui.auth.enabled: true in the config file)\n"+
		"Or bind to loopback with --addr 127.0.0.1:4042.", addr)
}

// InsecureBind reports whether the server is reachable from the network without TLS.
func InsecureBind(addr string, tls bool) bool { return !tls && !IsLoopbackAddr(addr) }

// hostCheck rejects requests whose Host header is not a loopback name on the listen port
// (DNS rebinding protection when auth is off).
func hostCheck(listenAddr string) gin.HandlerFunc {
	_, port, _ := net.SplitHostPort(listenAddr)
	return func(c *gin.Context) {
		if !hostAllowed(c.Request.Host, port) {
			c.AbortWithStatusJSON(http.StatusMisdirectedRequest, gin.H{"error": gin.H{"code": "bad_host", "message": "Host header not allowed; open the UI at http://localhost:" + port}})
			return
		}
		c.Next()
	}
}

func hostAllowed(host, port string) bool {
	h, p, err := net.SplitHostPort(host)
	if err != nil {
		h, p = strings.Trim(host, "[]"), ""
	}
	switch strings.ToLower(h) {
	case "localhost", "127.0.0.1", "::1":
	default:
		return false
	}
	return p == port || (p == "" && (port == "80" || port == "443"))
}
