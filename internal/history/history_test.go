package history

import (
	"strings"
	"testing"

	"github.com/0funct0ry/helenus/internal/schema"
)

func fixture() *schema.Snapshot {
	return &schema.Snapshot{Version: "4.1.3", Keyspaces: []schema.Keyspace{{
		Name: "shop", DurableWrites: true,
		Replication: map[string]string{"class": "org.apache.cassandra.locator.NetworkTopologyStrategy", "dc1": "3"},
		Tables: []schema.Table{{
			Keyspace: "shop", Name: "users",
			Columns: []schema.Column{
				{Name: "id", CQL: "uuid", Kind: schema.KindPartition, Position: 1},
				{Name: "name", CQL: "text", Kind: schema.KindRegular},
				{Name: "email", CQL: "text", Kind: schema.KindRegular},
			},
			Options:  []schema.Option{{Name: "comment", Value: "'users'"}, {Name: "gc_grace_seconds", Value: "864000"}},
			Triggers: []schema.Trigger{{Name: "audit", Class: "org.example.Audit"}},
		}},
		Types: []schema.UDT{{Keyspace: "shop", Name: "addr", Fields: []schema.Field{{Name: "street", CQL: "text"}}}},
		Functions: []schema.Function{{
			Keyspace: "shop", Name: "plus", ArgNames: []string{"a"}, ArgTypes: []string{"int"}, ReturnType: "int",
			Language: "java", Body: "return a;", CalledOnNull: true,
		}},
	}}}
}

func TestReverse(t *testing.T) {
	recreateUsers, _ := schema.Generate(fixture(), schema.Target{Kind: schema.TableT, Keyspace: "shop", Name: "users"}, "")
	cases := []struct {
		name, stmt, ks, want, note string
	}{
		{"create keyspace", "CREATE KEYSPACE app WITH replication = {'class':'SimpleStrategy','replication_factor':1}", "", "DROP KEYSPACE app;", ""},
		{"create table", "CREATE TABLE IF NOT EXISTS shop.t (id int PRIMARY KEY)", "", "DROP TABLE shop.t;", ""},
		{"create table unqualified", "CREATE TABLE t (id int PRIMARY KEY)", "shop", "DROP TABLE shop.t;", ""},
		{"create type", "CREATE TYPE shop.name (a text);", "", "DROP TYPE shop.name;", ""},
		{"create view", "CREATE MATERIALIZED VIEW shop.v AS SELECT * FROM shop.users WHERE id IS NOT NULL PRIMARY KEY (id)", "", "DROP MATERIALIZED VIEW shop.v;", ""},
		{"create index named", "CREATE INDEX by_name ON shop.users (name)", "", "DROP INDEX shop.by_name;", ""},
		{"create index unnamed", "CREATE INDEX ON shop.users (name)", "", "DROP INDEX shop.users_name_idx;", ""},
		{"create trigger", "CREATE TRIGGER audit ON shop.users USING 'org.example.Audit'", "", "DROP TRIGGER audit ON shop.users;", ""},
		{"create function", "CREATE OR REPLACE FUNCTION shop.f (a int, b map<text, int>) CALLED ON NULL INPUT RETURNS int LANGUAGE java AS 'return 1;'", "", "DROP FUNCTION shop.f(int, map<text, int>);", ""},
		{"create aggregate", "CREATE AGGREGATE shop.agg (int) SFUNC plus STYPE int", "", "DROP AGGREGATE shop.agg(int);", ""},
		{"create role", "CREATE ROLE bob WITH PASSWORD = 'x' AND LOGIN = true", "", "DROP ROLE bob;", ""},

		{"drop table", "DROP TABLE shop.users", "", recreateUsers[:len(recreateUsers)-1], NoteRecreate},
		{"drop type", "DROP TYPE shop.addr", "", "CREATE TYPE shop.addr (\n    street text\n);", NoteRecreate},
		{"drop function", "DROP FUNCTION shop.plus(int)", "", "", ""},
		{"drop trigger", "DROP TRIGGER audit ON shop.users", "", "CREATE TRIGGER audit ON shop.users USING 'org.example.Audit';", NoteRecreate},
		{"drop unknown", "DROP TABLE shop.nope", "", "", NoteNoReverse},
		{"drop keyspace", "DROP KEYSPACE shop", "", "", ""},

		{"add column", "ALTER TABLE shop.users ADD age int", "", "ALTER TABLE shop.users DROP age;", NoteDroppedData},
		{"add columns", "ALTER TABLE shop.users ADD (a int, b text)", "", "ALTER TABLE shop.users DROP (a, b);", NoteDroppedData},
		{"drop column", "ALTER TABLE shop.users DROP email", "", "ALTER TABLE shop.users ADD email text;", NoteRecreate},
		{"rename", "ALTER TABLE shop.users RENAME name TO full_name AND email TO mail", "", "ALTER TABLE shop.users RENAME full_name TO name AND mail TO email;", ""},
		{"with options", "ALTER TABLE shop.users WITH gc_grace_seconds = 3600", "", "ALTER TABLE shop.users WITH gc_grace_seconds = 864000;", ""},
		{"with two options", "ALTER TABLE shop.users WITH comment = 'new' AND gc_grace_seconds = 1", "", "ALTER TABLE shop.users WITH comment = 'users' AND gc_grace_seconds = 864000;", ""},
		{"alter keyspace", "ALTER KEYSPACE shop WITH replication = {'class':'SimpleStrategy','replication_factor':1} AND durable_writes = false", "", "", ""},
		{"type add", "ALTER TYPE shop.addr ADD zip text", "", "", NoteNoUDTRemove},
		{"type rename", "ALTER TYPE shop.addr RENAME street TO road", "", "ALTER TYPE shop.addr RENAME road TO street;", ""},
		{"role password", "ALTER ROLE bob WITH PASSWORD = 'new'", "", "", NotePassword},

		{"grant", "GRANT SELECT ON TABLE shop.users TO bob;", "", "REVOKE SELECT ON TABLE shop.users FROM bob;", ""},
		{"revoke", "REVOKE ALL PERMISSIONS ON KEYSPACE shop FROM bob", "", "GRANT ALL PERMISSIONS ON KEYSPACE shop TO bob;", ""},
		{"truncate", "TRUNCATE shop.users", "", "", NoteTruncate},
		{"unknown", "SELECT 1", "", "", NoteNoReverse},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, note := Reverse(fixture(), tc.ks, tc.stmt)
			switch tc.name {
			case "drop function":
				tc.want = schema.FunctionDDL(fixture().Keyspaces[0].Functions[0])
				tc.note = NoteRecreate
			case "drop keyspace":
				out, _ := schema.Generate(fixture(), schema.Target{Kind: schema.KeyspaceT, Name: "shop"}, "")
				tc.want, tc.note = out[:len(out)-1], NoteRecreate
			case "alter keyspace":
				tc.want = "ALTER KEYSPACE shop WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': '3'} AND durable_writes = true;"
			}
			if trimmed := strings.TrimSpace(got); trimmed != strings.TrimSpace(tc.want) || note != tc.note {
				t.Fatalf("Reverse(%q)\n got  %q (%q)\n want %q (%q)", tc.stmt, got, note, tc.want, tc.note)
			}
		})
	}
}

func TestParse(t *testing.T) {
	got := Parse("alter table shop.users add x int", "")
	want := Info{Action: "alter", Kind: "table", Keyspace: "shop", Name: "users"}
	if got != want {
		t.Fatalf("got %+v want %+v", got, want)
	}
	if g := Parse("CREATE TABLE t (a int PRIMARY KEY)", "ks"); g.Keyspace != "ks" || g.Name != "t" {
		t.Fatalf("unqualified: %+v", g)
	}
	if g := Parse("SELECT 1", ""); g.Action != "" {
		t.Fatalf("select parsed as %+v", g)
	}
}

func TestMaskPassword(t *testing.T) {
	cases := map[string]string{
		"CREATE ROLE b WITH PASSWORD = 'it''s' AND LOGIN = true": "CREATE ROLE b WITH PASSWORD = '••••••' AND LOGIN = true",
		"ALTER ROLE b WITH password='x'":                         "ALTER ROLE b WITH password='••••••'",
		"CREATE TABLE t (password text PRIMARY KEY)":             "CREATE TABLE t (password text PRIMARY KEY)",
	}
	for in, want := range cases {
		if got := MaskPassword(in); got != want {
			t.Errorf("MaskPassword(%q) = %q, want %q", in, got, want)
		}
	}
}
