package server

import (
	"context"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/config"
	"github.com/0funct0ry/helenus/internal/conn"
	"github.com/0funct0ry/helenus/internal/exec"
	"github.com/0funct0ry/helenus/internal/jobs"
	"github.com/0funct0ry/helenus/internal/schema"
	"github.com/0funct0ry/helenus/internal/store"
	"github.com/0funct0ry/helenus/internal/trace"
)

// Connector is what the API needs from the connection layer. conn.Manager
// backs it in production; tests substitute a fake.
type Connector interface {
	// Connect opens or reuses the profile's session and summarizes the cluster.
	Connect(ctx context.Context, name string, p config.Profile) (*conn.ClusterInfo, []string, error)
	Connected(name string) bool
	Disconnect(name string)
	Test(ctx context.Context, p config.Profile) *conn.TestResult
	// Schema returns the cached schema snapshot, re-reading it first when refresh is set.
	Schema(ctx context.Context, name string, p config.Profile, refresh bool) (*schema.Snapshot, error)
	// Describe renders a DESCRIBE target for the profile's cluster.
	Describe(ctx context.Context, name string, p config.Profile, t schema.Target) (string, error)
	// Query executes one statement on the profile's session.
	Query(ctx context.Context, name string, p config.Profile, req exec.Request) (*exec.Result, error)
	// Trace fetches the shaped trace session id, polling while Cassandra writes it.
	Trace(ctx context.Context, name string, p config.Profile, id string) (*trace.Trace, error)
	CloseAll()
}

type managerConnector struct {
	m     *conn.Manager
	cache *schema.Cache
}

func newManagerConnector() managerConnector {
	return managerConnector{m: conn.NewManager(), cache: schema.NewCache()}
}

func (c managerConnector) Connect(ctx context.Context, name string, p config.Profile) (*conn.ClusterInfo, []string, error) {
	sess, warnings, err := c.m.Session(ctx, name, p)
	if err != nil {
		return nil, warnings, err
	}
	info, err := conn.Info(ctx, sess)
	return info, warnings, err
}
func (c managerConnector) Connected(name string) bool { return c.m.Connected(name) }
func (c managerConnector) Disconnect(name string) {
	c.m.Close(name)
	c.cache.Invalidate(name)
}
func (c managerConnector) Test(ctx context.Context, p config.Profile) *conn.TestResult {
	return conn.Test(ctx, p)
}
func (c managerConnector) Schema(ctx context.Context, name string, p config.Profile, refresh bool) (*schema.Snapshot, error) {
	sess, _, err := c.m.Session(ctx, name, p)
	if err != nil {
		return nil, err
	}
	if refresh {
		return c.cache.Refresh(ctx, name, sess)
	}
	return c.cache.Get(ctx, name, sess)
}

func (c managerConnector) Describe(ctx context.Context, name string, p config.Profile, t schema.Target) (string, error) {
	sess, _, err := c.m.Session(ctx, name, p)
	if err != nil {
		return "", err
	}
	return c.cache.Describe(ctx, name, sess, t, "")
}

func (c managerConnector) Query(ctx context.Context, name string, p config.Profile, req exec.Request) (*exec.Result, error) {
	sess, _, err := c.m.Session(ctx, name, p)
	if err != nil {
		return nil, err
	}
	if d, err := time.ParseDuration(p.RequestTimeout); err == nil && req.Timeout == 0 {
		req.Timeout = d
	}
	return exec.ForSession(sess, c.cache, name).Run(ctx, req)
}

func (c managerConnector) Trace(ctx context.Context, name string, p config.Profile, id string) (*trace.Trace, error) {
	sess, _, err := c.m.Session(ctx, name, p)
	if err != nil {
		return nil, err
	}
	return exec.ForSession(sess, c.cache, name).Trace(ctx, id)
}

func (c managerConnector) CloseAll() { c.m.CloseAll() }

// api carries the dependencies shared by the handlers.
type api struct {
	configPath string
	dataDir    string
	conn       Connector
	store      *store.Store
	jobs       *jobs.Registry
	maxUpload  int64
	uploads    importUploads
	exports    exportFiles
	// writeMu serializes config file edits made through the API.
	writeMu sync.Mutex
}

// errorBody is the SPEC §11 error shape.
type errorBody struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Detail  any    `json:"detail,omitempty"`
	} `json:"error"`
}

func fail(c *gin.Context, status int, code, message string, detail any) {
	var b errorBody
	b.Error.Code, b.Error.Message, b.Error.Detail = code, message, detail
	c.AbortWithStatusJSON(status, b)
}

func (a *api) routes(r *gin.RouterGroup) {
	r.GET("/profiles", a.listProfiles)
	r.GET("/system-docs", a.systemDocs)
	r.POST("/profiles", a.createProfile)
	r.POST("/profiles/test", a.testUnsaved)
	r.POST("/profiles/astra/bundle", a.uploadBundle)
	r.PUT("/profiles/:name", a.updateProfile)
	r.DELETE("/profiles/:name", a.deleteProfile)
	r.POST("/profiles/:name/test", a.testSaved)

	p := r.Group("/p/:profile")
	p.POST("/connect", a.connect)
	p.DELETE("/connect", a.disconnect)
	p.GET("/cluster", a.cluster)
	p.POST("/query", a.query)
	p.POST("/split", a.split)
	p.GET("/traces/:id", a.trace)
	p.POST("/rows/format", a.rowsFormat)
	p.POST("/rows/aggregate", a.rowsAggregate)
	p.POST("/changes/preview", a.changesPreview)
	p.POST("/changes/apply", a.changesApply)
	p.POST("/types/preview", a.typesPreview)
	p.POST("/keyspaces/preview", a.keyspacesPreview)
	p.POST("/tables/preview", a.tablesPreview)
	p.POST("/indexes/preview", a.indexesPreview)
	p.POST("/triggers/preview", a.triggersPreview)
	p.GET("/roles", a.rolesList)
	p.GET("/roles/:role/permissions", a.rolesPermissions)
	p.POST("/roles/preview", a.rolesPreview)
	p.POST("/roles/apply", a.rolesApply)
	p.POST("/functions/preview", a.functionsPreview)
	p.POST("/functions/invoke", a.functionsInvoke)
	p.POST("/aggregates/preview", a.aggregatesPreview)
	p.POST("/aggregates/candidates", a.aggregatesCandidates)
	p.POST("/aggregates/test", a.aggregatesTest)
	p.POST("/views/preview", a.viewsPreview)
	p.POST("/seed/preview", a.seedPreview)
	p.POST("/seed/run", a.seedRun)
	p.GET("/seed/profiles", a.seedProfilesList)
	p.POST("/seed/profiles", a.seedProfilesSave)
	p.PUT("/seed/profiles/:id", a.seedProfilesUpdate)
	p.DELETE("/seed/profiles/:id", a.seedProfilesDelete)
	p.POST("/export", a.exportStart)
	p.GET("/export/presets", a.exportPresetsList)
	p.POST("/export/presets", a.exportPresetsCreate)
	p.PUT("/export/presets/:id", a.exportPresetsUpdate)
	p.DELETE("/export/presets/:id", a.exportPresetsDelete)
	p.GET("/export/:job/file", a.exportFile)
	p.POST("/import/upload", a.importUploadHandler)
	p.POST("/import/plan", a.importPlan)
	p.POST("/import/dry-run", a.importDryRun)
	p.POST("/import/run", a.importRun)
	p.GET("/import/:job/errors", a.importErrors)
	p.GET("/jobs", a.jobsList)
	p.GET("/jobs/:id", a.jobsGet)
	p.DELETE("/jobs/:id", a.jobsCancel)
	p.POST("/complete", a.complete)
	p.GET("/deps", a.deps)
	p.GET("/schema-changes", a.listSchemaChanges)
	p.DELETE("/schema-changes", a.clearSchemaChanges)
	p.GET("/ui-state", uiStateAPI{a}.get)
	p.PUT("/ui-state", uiStateAPI{a}.put)
	p.GET("/schema", a.schema)
	p.GET("/advise", a.adviseGet)
	p.POST("/schema/refresh", a.refreshSchema)
	p.GET("/keyspaces/:ks/tables/:t", a.tableDetail)
	p.GET("/keyspaces/:ks/ddl", a.ddl)
}
