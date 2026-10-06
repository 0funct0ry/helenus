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

	"github.com/0funct0ry/helenus/internal/auth"
	"github.com/0funct0ry/helenus/internal/config"
	"github.com/0funct0ry/helenus/internal/jobs"
	"github.com/0funct0ry/helenus/internal/store"
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
	// ConfigPath is the config file the profile routes read and write.
	ConfigPath string
	// DataDir holds uploaded Astra bundles; defaults to config.DataDir().
	DataDir string
	// Connector backs the connect routes; defaults to a conn.Manager.
	Connector Connector
	// DB is the SQLite file Run opens when Store is nil; empty means the XDG data path.
	DB string
	// Store holds the schema change history. Without one the history routes are empty and nothing is recorded.
	Store *store.Store
	// MaxUpload is the largest import upload in bytes; zero means 1 GB.
	MaxUpload int64
	// Auth requires sign-in on every API route except meta, healthz and auth/login (SPEC §12.2).
	Auth bool
	// TLSCert and TLSKey serve HTTPS when both are set.
	TLSCert, TLSKey string
}

// Run serves until ctx is cancelled or SIGINT/SIGTERM arrives, then shuts down gracefully.
func Run(ctx context.Context, opts Options) error {
	if opts.Stderr == nil {
		opts.Stderr = os.Stderr
	}
	ctx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := CheckBind(opts.Addr, opts.Auth); err != nil {
		return err
	}
	if (opts.TLSCert == "") != (opts.TLSKey == "") {
		return errors.New("--tls-cert and --tls-key must be given together")
	}
	ln, err := net.Listen("tcp", opts.Addr)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", opts.Addr, err)
	}
	opts.Addr = ln.Addr().String()
	if opts.Connector == nil {
		opts.Connector = newManagerConnector()
	}
	defer opts.Connector.CloseAll()
	if opts.Store == nil {
		st, err := store.Open(config.DBPath(opts.DB))
		if err != nil {
			_ = ln.Close()
			return fmt.Errorf("open database: %w", err)
		}
		defer func() { _ = st.Close() }()
		opts.Store = st
	}
	if opts.Auth {
		if n, err := opts.Store.CountUsers(); err != nil || n == 0 {
			_ = ln.Close()
			return errors.New("sign-in is on but there are no users. Create one with: helenus user add <username>")
		}
	}
	srv := &http.Server{Handler: NewRouter(opts), ReadHeaderTimeout: 10 * time.Second}

	scheme := "http"
	if opts.TLSCert != "" {
		scheme = "https"
	}
	url := scheme + "://" + opts.Addr
	fmt.Fprintf(opts.Stderr, "helenus ui listening on %s\n", url)
	if InsecureBind(opts.Addr, opts.TLSCert != "") {
		fmt.Fprintf(opts.Stderr, "warning: %s is reachable from the network over plain HTTP; passwords and sessions can be sniffed. Serve HTTPS with --tls-cert and --tls-key.\n", opts.Addr)
	}
	if opts.Open {
		if err := openBrowser(url); err != nil {
			fmt.Fprintf(opts.Stderr, "could not open the browser: %v\n", err)
		}
	}

	errCh := make(chan error, 1)
	go func() {
		if opts.TLSCert != "" {
			errCh <- srv.ServeTLS(ln, opts.TLSCert, opts.TLSKey)
			return
		}
		errCh <- srv.Serve(ln)
	}()
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
	if opts.Connector == nil {
		opts.Connector = newManagerConnector()
	}
	if opts.DataDir == "" {
		opts.DataDir = config.DataDir()
	}
	if opts.ConfigPath == "" {
		opts.ConfigPath, _ = config.ConfigPath("")
	}
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	// Client IPs for rate limiting come from the socket, never from forwarded headers.
	_ = r.SetTrustedProxies(nil)
	// Request logging goes to stderr; request bodies are never logged (SPEC §11.4).
	r.Use(gin.LoggerWithWriter(opts.Stderr), gin.Recovery())

	tls := opts.TLSCert != "" && opts.TLSKey != ""
	var svc *auth.Service
	if opts.Auth && opts.Store != nil {
		svc = auth.New(opts.Store)
	} else if opts.Addr != "" {
		r.Use(hostCheck(opts.Addr))
	}

	r.GET("/healthz", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })
	public := r.Group("/api/v1", csrf())
	public.GET("/meta", func(c *gin.Context) {
		meta := gin.H{"version": opts.Version, "auth_enabled": svc != nil, "tls": tls, "insecure_bind": opts.Addr != "" && InsecureBind(opts.Addr, tls)}
		if svc != nil {
			if tok, err := c.Cookie(sessionCookie); err == nil {
				if sess, err := svc.Verify(tok); err == nil {
					meta["user"] = sess.User.Username
				}
			}
		}
		c.JSON(http.StatusOK, meta)
	})
	protected := public.Group("")
	h := &api{configPath: opts.ConfigPath, dataDir: opts.DataDir, conn: opts.Connector, store: opts.Store, jobs: jobs.New(), maxUpload: opts.MaxUpload}
	if svc != nil {
		a := &authAPI{svc: svc, secure: tls}
		public.POST("/auth/login", a.login)
		protected.Use(requireAuth(svc, tls))
		protected.POST("/auth/logout", a.logout)
		protected.GET("/auth/me", a.me)
	}
	h.routes(protected)
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
