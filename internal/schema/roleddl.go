package schema

import (
	"fmt"
	"sort"
	"strings"
)

// Role actions accepted by PlanRole (SPEC §9.23).
const (
	RoleCreate     = "create"
	RoleAlter      = "alter"
	RoleDrop       = "drop"
	RoleGrantRole  = "grant_role"
	RoleRevokeRole = "revoke_role"
	RoleGrant      = "grant"
	RoleRevoke     = "revoke"
)

// Resource kinds a permission can be granted on.
const (
	ResAllKeyspaces  = "all_keyspaces"
	ResKeyspace      = "keyspace"
	ResTable         = "table"
	ResAllRoles      = "all_roles"
	ResRole          = "role"
	ResAllFunctions  = "all_functions"
	ResFunctionsInKS = "all_functions_in_keyspace"
	ResFunction      = "function"
	ResAllMBeans     = "all_mbeans"
	ResMBean         = "mbean"
)

// PasswordMask replaces a password in every preview and stored statement.
const PasswordMask = "'••••••'"

// MinPasswordLen is the shortest password the planner accepts.
const MinPasswordLen = 8

// Resource names the object a permission applies to. Keyspace is used by keyspace, table and
// function kinds; Name is the table, role, function name or MBean pattern; Signature holds the
// function's argument types.
type Resource struct {
	Kind      string   `json:"kind"`
	Keyspace  string   `json:"keyspace,omitempty"`
	Name      string   `json:"name,omitempty"`
	Signature []string `json:"signature,omitempty"`
}

// RoleRequest describes one role statement. Login and Superuser are pointers so alter only
// sets the clauses that were given.
type RoleRequest struct {
	Action      string            `json:"action"`
	Role        string            `json:"role"`
	Password    string            `json:"password,omitempty"`
	Login       *bool             `json:"login,omitempty"`
	Superuser   *bool             `json:"superuser,omitempty"`
	Options     map[string]string `json:"options,omitempty"`
	MemberOf    string            `json:"member_of,omitempty"`
	Permission  string            `json:"permission,omitempty"`
	Resource    *Resource         `json:"resource,omitempty"`
	IfNotExists bool              `json:"if_not_exists,omitempty"`
}

// RoleContext is what the planner needs to know about the cluster's roles.
type RoleContext struct {
	// MemberOf maps each existing role to the roles it was directly granted.
	MemberOf map[string][]string
	// Connected is the role the profile signs in as.
	Connected string
	// Major is the server's major version (0 when unknown).
	Major int
}

// RolePlan is the masked plan: Statement never contains the password.
type RolePlan = KeyspacePlan

var baseKS = []string{"CREATE", "ALTER", "DROP", "SELECT", "MODIFY", "AUTHORIZE"}

// ApplicablePermissions lists the permissions that can be granted on a resource kind, ALL first.
func ApplicablePermissions(kind string, major int) []string {
	var p []string
	switch kind {
	case ResAllKeyspaces, ResKeyspace:
		p = append(p, baseKS...)
		if major >= 5 {
			p = append(p, "UNMASK", "SELECT_MASKED")
		}
	case ResTable:
		p = []string{"ALTER", "DROP", "SELECT", "MODIFY", "AUTHORIZE"}
		if major >= 5 {
			p = append(p, "UNMASK", "SELECT_MASKED")
		}
	case ResAllRoles:
		p = []string{"CREATE", "ALTER", "DROP", "AUTHORIZE", "DESCRIBE"}
	case ResRole:
		p = []string{"ALTER", "DROP", "AUTHORIZE"}
	case ResAllFunctions, ResFunctionsInKS:
		p = []string{"CREATE", "ALTER", "DROP", "AUTHORIZE", "EXECUTE"}
	case ResFunction:
		p = []string{"ALTER", "DROP", "AUTHORIZE", "EXECUTE"}
	case ResAllMBeans, ResMBean:
		p = []string{"SELECT", "MODIFY", "DESCRIBE"}
	default:
		return nil
	}
	return append([]string{"ALL"}, p...)
}

func roleIdent(r string) string { return Ident(r) }

// PlanRole validates req and returns the masked statement.
func PlanRole(snap *Snapshot, rc RoleContext, req RoleRequest) RolePlan {
	p, _ := planRole(snap, rc, req)
	return p
}

// RenderRole validates req and returns the real statement, including any password. It must only
// be used to execute; nothing derived from it may be returned or logged.
func RenderRole(snap *Snapshot, rc RoleContext, req RoleRequest) (string, []PlanError) {
	p, real := planRole(snap, rc, req)
	return real, p.Errors
}

func planRole(snap *Snapshot, rc RoleContext, req RoleRequest) (RolePlan, string) {
	p := RolePlan{Errors: []PlanError{}, Notes: []string{}}
	fail := func(field, msg string) { p.Errors = append(p.Errors, PlanError{Field: field, Message: msg}) }
	done := func(masked, real string) (RolePlan, string) {
		if len(p.Errors) == 0 {
			p.Statement = masked
			return p, real
		}
		return p, ""
	}

	if req.Role == "" {
		fail("role", "Role name is required")
		return p, ""
	}
	_, exists := rc.MemberOf[req.Role]
	r := roleIdent(req.Role)

	switch req.Action {
	case RoleCreate, RoleAlter:
		if req.Action == RoleCreate {
			switch {
			case exists && !req.IfNotExists:
				fail("role", fmt.Sprintf("Role %s already exists", req.Role))
			case exists:
				p.Notes = append(p.Notes, fmt.Sprintf("Role %s already exists; IF NOT EXISTS makes this a no-op", req.Role))
			}
		} else if !exists {
			fail("role", fmt.Sprintf("Role %s not found", req.Role))
		}
		if req.Password != "" && len([]rune(req.Password)) < MinPasswordLen {
			fail("password", fmt.Sprintf("Use at least %d characters", MinPasswordLen))
		}
		var maskedC, realC []string
		if req.Password != "" {
			maskedC = append(maskedC, "PASSWORD = "+PasswordMask)
			realC = append(realC, "PASSWORD = "+quote(req.Password))
		}
		for _, c := range []struct {
			name string
			v    *bool
		}{{"LOGIN", req.Login}, {"SUPERUSER", req.Superuser}} {
			if c.v != nil {
				s := fmt.Sprintf("%s = %t", c.name, *c.v)
				maskedC, realC = append(maskedC, s), append(realC, s)
			}
		}
		if len(req.Options) > 0 {
			keys := make([]string, 0, len(req.Options))
			for k := range req.Options {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			parts := make([]string, len(keys))
			for i, k := range keys {
				parts[i] = quote(k) + ": " + quote(req.Options[k])
			}
			s := "OPTIONS = {" + strings.Join(parts, ", ") + "}"
			maskedC, realC = append(maskedC, s), append(realC, s)
		}
		head := "CREATE ROLE "
		if req.Action == RoleCreate && req.IfNotExists {
			head += "IF NOT EXISTS "
		} else if req.Action == RoleAlter {
			head = "ALTER ROLE "
		}
		if len(maskedC) == 0 {
			if req.Action == RoleAlter {
				fail("role", "Nothing to change")
			}
			return done(head+r+";", head+r+";")
		}
		if req.Action == RoleCreate && req.Password == "" && req.Login != nil && *req.Login {
			fail("password", "A role that can log in needs a password")
		}
		return done(head+r+" WITH "+strings.Join(maskedC, " AND ")+";", head+r+" WITH "+strings.Join(realC, " AND ")+";")

	case RoleDrop:
		switch {
		case !exists:
			fail("role", fmt.Sprintf("Role %s not found", req.Role))
		case req.Role == rc.Connected:
			fail("role", fmt.Sprintf("You are signed in as %s", req.Role))
		}
		s := "DROP ROLE " + r + ";"
		return done(s, s)

	case RoleGrantRole, RoleRevokeRole:
		parent := req.MemberOf
		switch {
		case parent == "":
			fail("member_of", "Role to grant is required")
		case !exists:
			fail("role", fmt.Sprintf("Role %s not found", req.Role))
		default:
			if _, ok := rc.MemberOf[parent]; !ok {
				fail("member_of", fmt.Sprintf("Role %s not found", parent))
			} else if req.Action == RoleGrantRole && reachable(rc.MemberOf, parent, req.Role) {
				fail("member_of", fmt.Sprintf("Granting %s to %s would create a circular grant", parent, req.Role))
			}
		}
		var s string
		if req.Action == RoleGrantRole {
			s = "GRANT " + roleIdent(parent) + " TO " + r + ";"
		} else {
			s = "REVOKE " + roleIdent(parent) + " FROM " + r + ";"
		}
		return done(s, s)

	case RoleGrant, RoleRevoke:
		perm := strings.ToUpper(req.Permission)
		res := req.Resource
		if !exists {
			fail("role", fmt.Sprintf("Role %s not found", req.Role))
		}
		if res == nil {
			fail("resource", "Resource is required")
			return p, ""
		}
		okPair := false
		for _, a := range ApplicablePermissions(res.Kind, rc.Major) {
			okPair = okPair || a == perm
		}
		if !okPair {
			fail("permission", fmt.Sprintf("%s cannot be granted on %s", perm, strings.ReplaceAll(res.Kind, "_", " ")))
		}
		rs, errMsg := renderResource(snap, *res)
		if errMsg != "" {
			fail("resource", errMsg)
		}
		var s string
		if req.Action == RoleGrant {
			s = "GRANT " + perm + " ON " + rs + " TO " + r + ";"
		} else {
			s = "REVOKE " + perm + " ON " + rs + " FROM " + r + ";"
		}
		return done(s, s)
	}
	fail("action", "Unknown action "+req.Action)
	return p, ""
}

// reachable reports whether target is from or one of from's direct or inherited parents.
func reachable(g map[string][]string, from, target string) bool {
	seen := map[string]bool{}
	var walk func(string) bool
	walk = func(r string) bool {
		if r == target {
			return true
		}
		if seen[r] {
			return false
		}
		seen[r] = true
		for _, n := range g[r] {
			if walk(n) {
				return true
			}
		}
		return false
	}
	return walk(from)
}

func renderResource(snap *Snapshot, r Resource) (string, string) {
	ks := func() (*Keyspace, string) {
		if r.Keyspace == "" {
			return nil, "Keyspace is required"
		}
		if snap == nil {
			return nil, ""
		}
		k := snap.Keyspace(r.Keyspace)
		if k == nil {
			return nil, fmt.Sprintf("Keyspace %s not found", r.Keyspace)
		}
		return k, ""
	}
	switch r.Kind {
	case ResAllKeyspaces:
		return "ALL KEYSPACES", ""
	case ResKeyspace:
		if _, e := ks(); e != "" {
			return "", e
		}
		return "KEYSPACE " + Ident(r.Keyspace), ""
	case ResTable:
		k, e := ks()
		if e != "" {
			return "", e
		}
		if r.Name == "" {
			return "", "Table is required"
		}
		if k != nil && k.Table(r.Name) == nil {
			return "", fmt.Sprintf("Table %s not found", r.Name)
		}
		return "TABLE " + qname(r.Keyspace, r.Name), ""
	case ResAllRoles:
		return "ALL ROLES", ""
	case ResRole:
		if r.Name == "" {
			return "", "Role is required"
		}
		return "ROLE " + roleIdent(r.Name), ""
	case ResAllFunctions:
		return "ALL FUNCTIONS", ""
	case ResFunctionsInKS:
		if _, e := ks(); e != "" {
			return "", e
		}
		return "ALL FUNCTIONS IN KEYSPACE " + Ident(r.Keyspace), ""
	case ResFunction:
		if _, e := ks(); e != "" {
			return "", e
		}
		if r.Name == "" {
			return "", "Function is required"
		}
		return "FUNCTION " + qname(r.Keyspace, r.Name) + "(" + strings.Join(r.Signature, ", ") + ")", ""
	case ResAllMBeans:
		return "ALL MBEANS", ""
	case ResMBean:
		if r.Name == "" {
			return "", "MBean name is required"
		}
		return "MBEAN " + quote(r.Name), ""
	}
	return "", "Unknown resource kind " + r.Kind
}
