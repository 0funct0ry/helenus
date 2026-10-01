package server

import (
	"context"
	"sync"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/config"
	"github.com/0funct0ry/helenus/internal/conn"
)

// Connector is what the API needs from the connection layer. conn.Manager
// backs it in production; tests substitute a fake.
type Connector interface {
	// Connect opens or reuses the profile's session and summarizes the cluster.
	Connect(ctx context.Context, name string, p config.Profile) (*conn.ClusterInfo, []string, error)
	Connected(name string) bool
	Disconnect(name string)
	Test(ctx context.Context, p config.Profile) *conn.TestResult
	CloseAll()
}

type managerConnector struct{ m *conn.Manager }

func (c managerConnector) Connect(ctx context.Context, name string, p config.Profile) (*conn.ClusterInfo, []string, error) {
	sess, warnings, err := c.m.Session(ctx, name, p)
	if err != nil {
		return nil, warnings, err
	}
	info, err := conn.Info(ctx, sess)
	return info, warnings, err
}
func (c managerConnector) Connected(name string) bool { return c.m.Connected(name) }
func (c managerConnector) Disconnect(name string)     { c.m.Close(name) }
func (c managerConnector) Test(ctx context.Context, p config.Profile) *conn.TestResult {
	return conn.Test(ctx, p)
}
func (c managerConnector) CloseAll() { c.m.CloseAll() }

// api carries the dependencies shared by the handlers.
type api struct {
	configPath string
	dataDir    string
	conn       Connector
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
}
