package schema

import (
	"strings"
	"testing"
)

func triggerSnapshot() *Snapshot {
	users := Table{Keyspace: "shop", Name: "users", Triggers: []Trigger{{Name: "audit", Class: "org.example.Audit"}}}
	return &Snapshot{Keyspaces: []Keyspace{
		{Name: "shop", Tables: []Table{users}},
		{Name: "system_x", System: true, Tables: []Table{{Name: "t"}}},
	}}
}

func TestPlanTrigger(t *testing.T) {
	tests := []struct {
		name string
		req  TriggerRequest
		want string
		err  string
	}{
		{"create", TriggerRequest{Action: "create", Keyspace: "shop", Table: "users", Name: "log", Class: "com.example.Audit"},
			"CREATE TRIGGER log ON shop.users USING 'com.example.Audit';", ""},
		{"create if not exists", TriggerRequest{Action: "create", Keyspace: "shop", Table: "users", Name: "audit", Class: "a.B", IfNotExists: true},
			"CREATE TRIGGER IF NOT EXISTS audit ON shop.users USING 'a.B';", ""},
		{"double dot", TriggerRequest{Action: "create", Keyspace: "shop", Table: "users", Name: "log", Class: "com..Audit"}, "", "class="},
		{"empty class", TriggerRequest{Action: "create", Keyspace: "shop", Table: "users", Name: "log"}, "", "class="},
		{"duplicate", TriggerRequest{Action: "create", Keyspace: "shop", Table: "users", Name: "audit", Class: "a.B"}, "", "name="},
		{"bad name", TriggerRequest{Action: "create", Keyspace: "shop", Table: "users", Name: "1x", Class: "a.B"}, "", "name="},
		{"missing table", TriggerRequest{Action: "create", Keyspace: "shop", Table: "nope", Name: "x", Class: "a.B"}, "", "table="},
		{"system", TriggerRequest{Action: "create", Keyspace: "system_x", Table: "t", Name: "x", Class: "a.B"}, "", "keyspace="},
		{"drop", TriggerRequest{Action: "drop", Keyspace: "shop", Table: "users", Name: "audit"}, "DROP TRIGGER audit ON shop.users;", ""},
		{"drop if exists", TriggerRequest{Action: "drop", Keyspace: "shop", Table: "users", Name: "zzz", IfExists: true},
			"DROP TRIGGER IF EXISTS zzz ON shop.users;", ""},
		{"drop missing", TriggerRequest{Action: "drop", Keyspace: "shop", Table: "users", Name: "zzz"}, "", "name="},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p := PlanTrigger(triggerSnapshot(), tc.req)
			if tc.err != "" {
				if p.Statement != "" || len(p.Errors) == 0 || !strings.HasPrefix(p.Errors[0].Field+"=", tc.err) {
					t.Fatalf("want error %q, got %+v", tc.err, p)
				}
				return
			}
			if len(p.Errors) != 0 || p.Statement != tc.want {
				t.Fatalf("got %+v, want %q", p, tc.want)
			}
			if tc.req.Action == "create" && !strings.Contains(strings.Join(p.Notes, "|"), "triggers directory") {
				t.Errorf("missing JAR note: %v", p.Notes)
			}
		})
	}
}
