// Package server is the Gin HTTP server behind `helenus ui`: the JSON API and
// the embedded web app.
package server

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/web"
)

// Options configures the server.
type Options struct {
	Addr    string
	Open    bool
	Version string
	// Assets is the web app file system; defaults to the embedded web/dist.
	Assets fs.FS
	Stderr io.Writer
}

// Run serves until ctx is cancelled or SIGINT/SIGTERM arrives, then shuts down gracefully.
func Run(ctx context.Context, opts Options) error {
	if opts.Stderr == nil {
		opts.Stderr = os.Stderr
	}
	ctx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()

	ln, err := net.Listen("tcp", opts.Addr)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", opts.Addr, err)
	}
	srv := &http.Server{Handler: NewRouter(opts), ReadHeaderTimeout: 10 * time.Second}

	url := "http://" + ln.Addr().String()
	fmt.Fprintf(opts.Stderr, "helenus ui listening on %s\n", url)
	if opts.Open {
		if err := openBrowser(url); err != nil {
			fmt.Fprintf(opts.Stderr, "could not open the browser: %v\n", err)
		}
	}

	errCh := make(chan error, 1)
	go func() { errCh <- srv.Serve(ln) }()
	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return err
	}
	if err := <-errCh; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// NewRouter builds the HTTP handler: API routes, health check and static assets.
func NewRouter(opts Options) http.Handler {
	if opts.Assets == nil {
		opts.Assets = web.Dist()
	}
	if opts.Stderr == nil {
		opts.Stderr = os.Stderr
	}
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	// Request logging goes to stderr; request bodies are never logged (SPEC §11.4).
	r.Use(gin.LoggerWithWriter(opts.Stderr), gin.Recovery())

	r.GET("/healthz", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })
	r.GET("/api/v1/meta", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"version": opts.Version, "auth_enabled": false})
	})
	r.NoRoute(staticHandler(opts.Assets))
	return r
}

func openBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	return cmd.Start()
}
