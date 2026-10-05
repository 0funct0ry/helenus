package server

import (
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/config"
	"github.com/0funct0ry/helenus/internal/conn"
	"github.com/0funct0ry/helenus/internal/exec"
	"github.com/0funct0ry/helenus/internal/history"
	"github.com/0funct0ry/helenus/internal/schema"
)

// roleInfo is one row of the role list.
type roleInfo struct {
	Name      string            `json:"name"`
	Login     bool              `json:"login"`
	Superuser bool              `json:"superuser"`
	Options   map[string]string `json:"options"`
	MemberOf  []string          `json:"member_of"`
	Members   []string          `json:"members"`
}

// rolesResponse is the body of GET /roles.
type rolesResponse struct {
	AuthEnabled       bool                `json:"auth_enabled"`
	AuthorizerEnabled bool                `json:"authorizer_enabled"`
	Connected         string              `json:"connected_role"`
	Roles             []roleInfo          `json:"roles"`
	Applicable        map[string][]string `json:"applicable"`
}

// permissionInfo is one directly granted permission.
type permissionInfo struct {
	Resource   schema.Resource `json:"resource"`
	Permission string          `json:"permission"`
}

var resourceKinds = []string{
	schema.ResAllKeyspaces, schema.ResKeyspace, schema.ResTable, schema.ResAllRoles, schema.ResRole,
	schema.ResAllFunctions, schema.ResFunctionsInKS, schema.ResFunction, schema.ResAllMBeans, schema.ResMBean,
}

// authDisabledErr reports whether err means the cluster has no authenticator, role manager or
// authorizer that supports the statement.
func authDisabledErr(err error) bool {
	var re gocql.RequestError
	if !errors.As(err, &re) {
		return false
	}
	m := strings.ToLower(re.Message())
	for _, s := range []string{"allowall", "not supported", "not logged in", "logged in", "anonymous", "unauthorized"} {
		if strings.Contains(m, s) {
			return true
		}
	}
	return false
}

func asBool(v any) bool {
	switch b := v.(type) {
	case bool:
		return b
	case *bool:
		return b != nil && *b
	}
	return false
}

func asString(v any) string {
	switch s := v.(type) {
	case string:
		return s
	case *string:
		if s != nil {
			return *s
		}
	}
	return ""
}

func asOptions(v any) map[string]string {
	out := map[string]string{}
	if m, ok := v.(map[string]string); ok {
		for k, x := range m {
			out[k] = x
		}
	}
	return out
}

func colIndex(res *exec.Result, name string) int {
	for i, c := range res.Columns {
		if c.Name == name {
			return i
		}
	}
	return -1
}

func cell(res *exec.Result, row []any, name string) any {
	if i := colIndex(res, name); i >= 0 && i < len(row) {
		return row[i]
	}
	return nil
}

func (a *api) roleQuery(c *gin.Context, p config.Profile, cqlText string) (*exec.Result, error) {
	return a.conn.Query(c.Request.Context(), p.Name, p, exec.Request{CQL: cqlText})
}

// loadRoles lists roles with direct membership. authOK is false when roles are unavailable.
func (a *api) loadRoles(c *gin.Context, p config.Profile) (roles []roleInfo, authOK bool, err error) {
	if p.Username == "" {
		return []roleInfo{}, false, nil
	}
	res, err := a.roleQuery(c, p, "LIST ROLES")
	if err != nil {
		if authDisabledErr(err) {
			return []roleInfo{}, false, nil
		}
		return nil, false, err
	}
	idx := map[string]int{}
	for _, row := range res.Raw {
		name := asString(cell(res, row, "role"))
		idx[name] = len(roles)
		roles = append(roles, roleInfo{
			Name: name, Login: asBool(cell(res, row, "login")), Superuser: asBool(cell(res, row, "super")),
			Options: asOptions(cell(res, row, "options")), MemberOf: []string{}, Members: []string{},
		})
	}
	for i := range roles {
		r, qerr := a.roleQuery(c, p, "LIST ROLES OF "+schema.Ident(roles[i].Name)+" NORECURSIVE")
		if qerr != nil {
			return nil, true, qerr
		}
		for _, row := range r.Raw {
			parent := asString(cell(r, row, "role"))
			if parent == roles[i].Name {
				continue
			}
			roles[i].MemberOf = append(roles[i].MemberOf, parent)
			if j, ok := idx[parent]; ok {
				roles[j].Members = append(roles[j].Members, roles[i].Name)
			}
		}
	}
	return roles, true, nil
}

func (a *api) roleContext(c *gin.Context, p config.Profile) (*schema.Snapshot, schema.RoleContext, bool) {
	snap, err := a.conn.Schema(c.Request.Context(), p.Name, p, false)
	if err != nil {
		fail(c, http.StatusBadGateway, "schema_failed", err.Error(), nil)
		return nil, schema.RoleContext{}, false
	}
	roles, _, err := a.loadRoles(c, p)
	if err != nil {
		status, code, msg, _ := queryFailure(err, "")
		fail(c, status, code, msg, nil)
		return nil, schema.RoleContext{}, false
	}
	rc := schema.RoleContext{MemberOf: map[string][]string{}, Connected: p.Username}
	for _, r := range roles {
		rc.MemberOf[r.Name] = r.MemberOf
	}
	if snap != nil {
		rc.Major = schema.MajorVersion(snap.Version)
	}
	return snap, rc, true
}

// rolesGate resolves the connected profile and rejects Astra profiles, where roles are managed
// in Astra itself.
func (a *api) rolesGate(c *gin.Context) (config.Profile, bool) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return p, false
	}
	if conn.IsAstra(p) {
		fail(c, http.StatusNotFound, "unsupported", "Roles are managed in Astra", nil)
		return p, false
	}
	return p, true
}

// rolesList returns the roles, whether auth and authorization are enabled, and the permissions
// applicable to each resource kind (SPEC §9.23).
func (a *api) rolesList(c *gin.Context) {
	p, ok := a.rolesGate(c)
	if !ok {
		return
	}
	roles, authOK, err := a.loadRoles(c, p)
	if err != nil {
		status, code, msg, _ := queryFailure(err, "")
		fail(c, status, code, msg, nil)
		return
	}
	major := 0
	if snap, serr := a.conn.Schema(c.Request.Context(), p.Name, p, false); serr == nil && snap != nil {
		major = schema.MajorVersion(snap.Version)
	}
	out := rolesResponse{
		AuthEnabled: authOK, AuthorizerEnabled: authOK, Connected: p.Username, Roles: roles,
		Applicable: map[string][]string{},
	}
	for _, k := range resourceKinds {
		out.Applicable[k] = schema.ApplicablePermissions(k, major)
	}
	if authOK {
		if _, perr := a.roleQuery(c, p, "LIST ALL PERMISSIONS OF "+schema.Ident(p.Username)); perr != nil && authDisabledErr(perr) {
			out.AuthorizerEnabled = false
		}
	}
	c.JSON(http.StatusOK, out)
}

// parseResource turns the server's "<table ks.t>" form into a Resource.
func parseResource(s string) schema.Resource {
	s = strings.TrimSuffix(strings.TrimPrefix(s, "<"), ">")
	switch {
	case s == "all keyspaces":
		return schema.Resource{Kind: schema.ResAllKeyspaces}
	case s == "all roles":
		return schema.Resource{Kind: schema.ResAllRoles}
	case s == "all functions":
		return schema.Resource{Kind: schema.ResAllFunctions}
	case s == "all mbeans":
		return schema.Resource{Kind: schema.ResAllMBeans}
	case strings.HasPrefix(s, "all functions in "):
		return schema.Resource{Kind: schema.ResFunctionsInKS, Keyspace: strings.TrimPrefix(s, "all functions in ")}
	case strings.HasPrefix(s, "keyspace "):
		return schema.Resource{Kind: schema.ResKeyspace, Keyspace: strings.TrimPrefix(s, "keyspace ")}
	case strings.HasPrefix(s, "table "):
		ks, t, _ := strings.Cut(strings.TrimPrefix(s, "table "), ".")
		return schema.Resource{Kind: schema.ResTable, Keyspace: ks, Name: t}
	case strings.HasPrefix(s, "role "):
		return schema.Resource{Kind: schema.ResRole, Name: strings.TrimPrefix(s, "role ")}
	case strings.HasPrefix(s, "mbean "):
		return schema.Resource{Kind: schema.ResMBean, Name: strings.TrimPrefix(s, "mbean ")}
	case strings.HasPrefix(s, "function "):
		body := strings.TrimPrefix(s, "function ")
		head, sig, _ := strings.Cut(body, "(")
		ks, f, _ := strings.Cut(head, ".")
		return schema.Resource{Kind: schema.ResFunction, Keyspace: ks, Name: f, Signature: splitTypes(strings.TrimSuffix(sig, ")"))}
	}
	return schema.Resource{Kind: "unknown", Name: s}
}

// splitTypes splits "int, map<text, int>" on top-level commas.
func splitTypes(s string) []string {
	out := []string{}
	depth, start := 0, 0
	for i, r := range s {
		switch r {
		case '<', '(':
			depth++
		case '>', ')':
			depth--
		case ',':
			if depth == 0 {
				out = append(out, strings.TrimSpace(s[start:i]))
				start = i + 1
			}
		}
	}
	if t := strings.TrimSpace(s[start:]); t != "" {
		out = append(out, t)
	}
	return out
}

// rolesPermissions lists the permissions granted directly to a role.
func (a *api) rolesPermissions(c *gin.Context) {
	p, ok := a.rolesGate(c)
	if !ok {
		return
	}
	role := c.Param("role")
	res, err := a.roleQuery(c, p, "LIST ALL PERMISSIONS OF "+schema.Ident(role))
	if err != nil {
		if authDisabledErr(err) {
			c.JSON(http.StatusOK, gin.H{"authorizer_enabled": false, "permissions": []permissionInfo{}})
			return
		}
		status, code, msg, _ := queryFailure(err, "")
		fail(c, status, code, msg, nil)
		return
	}
	out := []permissionInfo{}
	for _, row := range res.Raw {
		if asString(cell(res, row, "role")) != role || (colIndex(res, "granted") >= 0 && !asBool(cell(res, row, "granted"))) {
			continue
		}
		out = append(out, permissionInfo{
			Resource: parseResource(asString(cell(res, row, "resource"))), Permission: asString(cell(res, row, "permission")),
		})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Permission < out[j].Permission })
	c.JSON(http.StatusOK, gin.H{"authorizer_enabled": true, "permissions": out})
}

// rolesPreview plans a role statement with the password masked.
func (a *api) rolesPreview(c *gin.Context) {
	p, ok := a.rolesGate(c)
	if !ok {
		return
	}
	var in schema.RoleRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", "invalid request body", nil)
		return
	}
	snap, rc, ok := a.roleContext(c, p)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, schema.PlanRole(snap, rc, in))
}

// rolesApply renders the real statement, runs it, and answers with the masked text only. The real
// statement is never logged, recorded or echoed.
func (a *api) rolesApply(c *gin.Context) {
	p, ok := a.rolesGate(c)
	if !ok {
		return
	}
	var in schema.RoleRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", "invalid request body", nil)
		return
	}
	snap, rc, ok := a.roleContext(c, p)
	if !ok {
		return
	}
	plan := schema.PlanRole(snap, rc, in)
	if len(plan.Errors) > 0 {
		fail(c, http.StatusUnprocessableEntity, "invalid_request", plan.Errors[0].Message, plan.Errors)
		return
	}
	real, _ := schema.RenderRole(snap, rc, in)
	started := time.Now()
	_, err := a.conn.Query(c.Request.Context(), p.Name, p, exec.Request{CQL: real})
	if a.store != nil {
		a.recordChange(p.Name, "", plan.Statement, snap, err, time.Since(started))
	}
	if err != nil {
		status, code, msg, _ := queryFailure(err, "")
		msg = history.MaskPassword(msg)
		if in.Password != "" {
			msg = strings.ReplaceAll(msg, in.Password, "••••••")
		}
		fail(c, status, code, msg, nil)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "statement": plan.Statement})
}
