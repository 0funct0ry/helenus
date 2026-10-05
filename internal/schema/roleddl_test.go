package schema

import (
	"strings"
	"testing"
)

func bp(b bool) *bool { return &b }

func roleCtx() RoleContext {
	return RoleContext{
		MemberOf:  map[string][]string{"admin": {}, "analyst": {"reader"}, "reader": {}, "me": {}},
		Connected: "me", Major: 5,
	}
}

func roleSnap() *Snapshot {
	return &Snapshot{Version: "5.0", Keyspaces: []Keyspace{{Name: "shop", Tables: []Table{{Keyspace: "shop", Name: "orders"}}}}}
}

func TestPlanRoleStatements(t *testing.T) {
	cases := []struct {
		name string
		req  RoleRequest
		want string
	}{
		{"create", RoleRequest{Action: RoleCreate, Role: "bob", Password: "s3cretpass", Login: bp(true), Superuser: bp(false)},
			"CREATE ROLE bob WITH PASSWORD = '••••••' AND LOGIN = true AND SUPERUSER = false;"},
		{"create plain", RoleRequest{Action: RoleCreate, Role: "bob", IfNotExists: true}, "CREATE ROLE IF NOT EXISTS bob;"},
		{"alter", RoleRequest{Action: RoleAlter, Role: "analyst", Login: bp(false)}, "ALTER ROLE analyst WITH LOGIN = false;"},
		{"alter password", RoleRequest{Action: RoleAlter, Role: "analyst", Password: "newpassword1"}, "ALTER ROLE analyst WITH PASSWORD = '••••••';"},
		{"drop", RoleRequest{Action: RoleDrop, Role: "analyst"}, "DROP ROLE analyst;"},
		{"grant role", RoleRequest{Action: RoleGrantRole, Role: "admin", MemberOf: "reader"}, "GRANT reader TO admin;"},
		{"revoke role", RoleRequest{Action: RoleRevokeRole, Role: "analyst", MemberOf: "reader"}, "REVOKE reader FROM analyst;"},
		{"grant ks", RoleRequest{Action: RoleGrant, Role: "analyst", Permission: "select", Resource: &Resource{Kind: ResKeyspace, Keyspace: "shop"}},
			"GRANT SELECT ON KEYSPACE shop TO analyst;"},
		{"revoke table", RoleRequest{Action: RoleRevoke, Role: "analyst", Permission: "MODIFY", Resource: &Resource{Kind: ResTable, Keyspace: "shop", Name: "orders"}},
			"REVOKE MODIFY ON TABLE shop.orders FROM analyst;"},
		{"all ks", RoleRequest{Action: RoleGrant, Role: "analyst", Permission: "ALL", Resource: &Resource{Kind: ResAllKeyspaces}}, "GRANT ALL ON ALL KEYSPACES TO analyst;"},
		{"function", RoleRequest{Action: RoleGrant, Role: "analyst", Permission: "EXECUTE", Resource: &Resource{Kind: ResFunction, Keyspace: "shop", Name: "f", Signature: []string{"int", "map<text, int>"}}},
			"GRANT EXECUTE ON FUNCTION shop.f(int, map<text, int>) TO analyst;"},
		{"funcs in ks", RoleRequest{Action: RoleGrant, Role: "analyst", Permission: "EXECUTE", Resource: &Resource{Kind: ResFunctionsInKS, Keyspace: "shop"}},
			"GRANT EXECUTE ON ALL FUNCTIONS IN KEYSPACE shop TO analyst;"},
		{"role res", RoleRequest{Action: RoleGrant, Role: "analyst", Permission: "DESCRIBE", Resource: &Resource{Kind: ResAllRoles}}, "GRANT DESCRIBE ON ALL ROLES TO analyst;"},
		{"mbean", RoleRequest{Action: RoleGrant, Role: "analyst", Permission: "SELECT", Resource: &Resource{Kind: ResMBean, Name: "org.apache.*"}}, "GRANT SELECT ON MBEAN 'org.apache.*' TO analyst;"},
	}
	for _, c := range cases {
		p := PlanRole(roleSnap(), roleCtx(), c.req)
		if len(p.Errors) != 0 || p.Statement != c.want {
			t.Errorf("%s: got %q errs %v, want %q", c.name, p.Statement, p.Errors, c.want)
		}
	}
}

func TestRenderRoleKeepsRealPassword(t *testing.T) {
	req := RoleRequest{Action: RoleCreate, Role: "bob", Password: "it's-secret", Login: bp(true)}
	real, errs := RenderRole(roleSnap(), roleCtx(), req)
	if len(errs) != 0 || real != "CREATE ROLE bob WITH PASSWORD = 'it''s-secret' AND LOGIN = true;" {
		t.Errorf("real = %q %v", real, errs)
	}
	if p := PlanRole(roleSnap(), roleCtx(), req); strings.Contains(p.Statement, "secret") {
		t.Errorf("masked leaks: %q", p.Statement)
	}
}

func TestPlanRoleErrors(t *testing.T) {
	cases := []struct {
		name string
		req  RoleRequest
		want string
	}{
		{"short password", RoleRequest{Action: RoleCreate, Role: "bob", Password: "short"}, "at least 8"},
		{"login without password", RoleRequest{Action: RoleCreate, Role: "bob", Login: bp(true)}, "needs a password"},
		{"exists", RoleRequest{Action: RoleCreate, Role: "admin"}, "already exists"},
		{"alter missing", RoleRequest{Action: RoleAlter, Role: "zz", Login: bp(true)}, "not found"},
		{"alter nothing", RoleRequest{Action: RoleAlter, Role: "admin"}, "Nothing to change"},
		{"drop self", RoleRequest{Action: RoleDrop, Role: "me"}, "You are signed in as me"},
		{"cycle", RoleRequest{Action: RoleGrantRole, Role: "reader", MemberOf: "analyst"}, "circular"},
		{"self cycle", RoleRequest{Action: RoleGrantRole, Role: "reader", MemberOf: "reader"}, "circular"},
		{"missing parent", RoleRequest{Action: RoleGrantRole, Role: "reader", MemberOf: "nope"}, "not found"},
		{"execute on table", RoleRequest{Action: RoleGrant, Role: "admin", Permission: "EXECUTE", Resource: &Resource{Kind: ResTable, Keyspace: "shop", Name: "orders"}}, "cannot be granted"},
		{"select on role", RoleRequest{Action: RoleGrant, Role: "admin", Permission: "SELECT", Resource: &Resource{Kind: ResRole, Name: "x"}}, "cannot be granted"},
		{"describe on ks", RoleRequest{Action: RoleGrant, Role: "admin", Permission: "DESCRIBE", Resource: &Resource{Kind: ResKeyspace, Keyspace: "shop"}}, "cannot be granted"},
		{"missing table", RoleRequest{Action: RoleGrant, Role: "admin", Permission: "SELECT", Resource: &Resource{Kind: ResTable, Keyspace: "shop", Name: "zz"}}, "not found"},
		{"no resource", RoleRequest{Action: RoleGrant, Role: "admin", Permission: "SELECT"}, "Resource is required"},
	}
	for _, c := range cases {
		p := PlanRole(roleSnap(), roleCtx(), c.req)
		if p.Statement != "" || len(p.Errors) == 0 || !strings.Contains(p.Errors[0].Message, c.want) {
			t.Errorf("%s: %+v, want error containing %q", c.name, p, c.want)
		}
	}
}

func TestApplicablePermissionsVersion(t *testing.T) {
	has := func(l []string, s string) bool {
		for _, x := range l {
			if x == s {
				return true
			}
		}
		return false
	}
	if has(ApplicablePermissions(ResKeyspace, 4), "UNMASK") || !has(ApplicablePermissions(ResKeyspace, 5), "UNMASK") {
		t.Error("UNMASK should be 5.0+ only")
	}
	if has(ApplicablePermissions(ResTable, 5), "EXECUTE") || !has(ApplicablePermissions(ResFunction, 4), "EXECUTE") {
		t.Error("EXECUTE only on functions")
	}
	if ApplicablePermissions("bogus", 5) != nil {
		t.Error("unknown kind")
	}
}
