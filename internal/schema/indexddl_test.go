package schema

import (
	"strings"
	"testing"

	"github.com/0funct0ry/helenus/internal/codec"
)

func indexSnapshot(version string) *Snapshot {
	frozen := func(t codec.TypeDesc) codec.TypeDesc { t.Frozen = true; return t }
	vec := codec.TypeDesc{Name: "vector", Args: []codec.TypeDesc{nat("float")}, Size: 3}
	cols := []Column{
		{Name: "id", Type: nat("uuid"), Kind: KindPartition},
		{Name: "name", Type: nat("text"), Kind: KindRegular},
		{Name: "email", Type: nat("text"), Kind: KindRegular},
		{Name: "age", Type: nat("int"), Kind: KindRegular},
		{Name: "created", Type: nat("timestamp"), Kind: KindRegular},
		{Name: "tags", Type: coll("set", nat("text")), Kind: KindRegular},
		{Name: "ftags", Type: frozen(coll("set", nat("text"))), Kind: KindRegular},
		{Name: "attrs", Type: coll("map", nat("text"), nat("int")), Kind: KindRegular},
		{Name: "fattrs", Type: frozen(coll("map", nat("text"), nat("int"))), Kind: KindRegular},
		{Name: "emb", Type: vec, Kind: KindRegular},
		{Name: "hits", Type: nat("counter"), Kind: KindRegular},
	}
	users := Table{Keyspace: "shop", Name: "users", Columns: cols,
		Indexes: []Index{{Name: "users_email_idx", Column: "email", Target: "email"}}}
	comp := Table{Keyspace: "shop", Name: "comp", Columns: []Column{
		{Name: "a", Type: nat("int"), Kind: KindPartition}, {Name: "b", Type: nat("int"), Kind: KindPartition}}}
	return &Snapshot{Version: version, Keyspaces: []Keyspace{
		{Name: "shop", Tables: []Table{users, comp}},
		{Name: "system_x", System: true, Tables: []Table{{Name: "t"}}},
	}}
}

func TestPlanIndex(t *testing.T) {
	yes := true
	tests := []struct {
		name    string
		version string
		req     IndexRequest
		want    string
		err     string // "field=message" substring
		notes   []string
	}{
		{name: "plain default name", req: IndexRequest{Table: "users", Column: "name"}, want: "CREATE INDEX users_name_idx ON shop.users (name);"},
		{name: "if not exists", req: IndexRequest{Table: "users", Column: "name", Name: "n1", IfNotExists: true}, want: "CREATE INDEX IF NOT EXISTS n1 ON shop.users (name);"},
		{name: "set default values", req: IndexRequest{Table: "users", Column: "tags"}, want: "CREATE INDEX users_tags_idx ON shop.users (VALUES(tags));"},
		{name: "map default values", req: IndexRequest{Table: "users", Column: "attrs"}, want: "CREATE INDEX users_attrs_idx ON shop.users (VALUES(attrs));"},
		{name: "map keys", req: IndexRequest{Table: "users", Column: "attrs", Target: "KEYS"}, want: "(KEYS(attrs));"},
		{name: "map entries", req: IndexRequest{Table: "users", Column: "attrs", Target: "ENTRIES"}, want: "(ENTRIES(attrs));"},
		{name: "frozen set full", req: IndexRequest{Table: "users", Column: "ftags"}, want: "(FULL(ftags));"},
		{name: "frozen map full", req: IndexRequest{Table: "users", Column: "fattrs"}, want: "(FULL(fattrs));"},
		{name: "frozen set values", req: IndexRequest{Table: "users", Column: "ftags", Target: "VALUES"}, err: "target="},
		{name: "scalar keys", req: IndexRequest{Table: "users", Column: "name", Target: "KEYS"}, err: "target="},
		{name: "counter", req: IndexRequest{Table: "users", Column: "hits"}, err: "column=Counter columns"},
		{name: "sole partition key", req: IndexRequest{Table: "users", Column: "id"}, err: "column=The only partition key"},
		{name: "composite partition key ok", req: IndexRequest{Table: "comp", Column: "a"}, want: "comp_a_idx ON shop.comp (a);"},
		{name: "vector legacy", version: "5.0.2", req: IndexRequest{Table: "users", Column: "emb"}, err: "Vector columns need an SAI index"},
		{name: "vector sai", version: "5.0.2", req: IndexRequest{Table: "users", Column: "emb", Kind: "sai", Options: IndexOptions{SimilarityFunction: "cosine"}},
			want: "CREATE INDEX users_emb_idx ON shop.users (emb) USING 'sai' WITH OPTIONS = {'similarity_function': 'cosine'};"},
		{name: "bad similarity", version: "5.0.2", req: IndexRequest{Table: "users", Column: "emb", Kind: "sai", Options: IndexOptions{SimilarityFunction: "x"}}, err: "similarity_function must be"},
		{name: "similarity on text", version: "5.0.2", req: IndexRequest{Table: "users", Column: "name", Kind: "sai", Options: IndexOptions{SimilarityFunction: "cosine"}}, err: "only applies to vector"},
		{name: "sai plain", version: "5.0.2", req: IndexRequest{Table: "users", Column: "age", Kind: "sai"}, want: "CREATE INDEX users_age_idx ON shop.users (age) USING 'sai';"},
		{name: "sai text options", version: "5.0.2", req: IndexRequest{Table: "users", Column: "name", Kind: "sai", Options: IndexOptions{CaseSensitive: new(bool), Normalize: &yes}},
			want: "USING 'sai' WITH OPTIONS = {'case_sensitive': 'false', 'normalize': 'true'};"},
		{name: "sai partition key ok", version: "5.0.2", req: IndexRequest{Table: "users", Column: "id", Kind: "sai"}, want: "(id) USING 'sai';"},
		{name: "text options on int", version: "5.0.2", req: IndexRequest{Table: "users", Column: "age", Kind: "sai", Options: IndexOptions{ASCII: &yes}}, err: "options=Text options"},
		{name: "options on legacy", req: IndexRequest{Table: "users", Column: "name", Options: IndexOptions{ASCII: &yes}}, err: "options=Options are only"},
		{name: "sai on 4.1", version: "4.1.5", req: IndexRequest{Table: "users", Column: "age", Kind: "sai"}, err: "kind=SAI needs server 5.0 or later"},
		{name: "duplicate", req: IndexRequest{Table: "users", Column: "email", Name: "other"}, err: "already covers"},
		{name: "name taken", req: IndexRequest{Table: "users", Column: "name", Name: "users_email_idx"}, err: "name=A table, view or index"},
		{name: "bad name", req: IndexRequest{Table: "users", Column: "name", Name: "1x"}, err: "name=Use letters"},
		{name: "unknown column", req: IndexRequest{Table: "users", Column: "zzz"}, err: "column=Column zzz"},
		{name: "unknown table", req: IndexRequest{Table: "zzz", Column: "a"}, err: "table=Table zzz"},
		{name: "system keyspace", req: IndexRequest{Keyspace: "system_x", Table: "t", Column: "a"}, err: "system keyspace"},
		{name: "high cardinality note", req: IndexRequest{Table: "users", Column: "created"}, want: "(created);", notes: []string{"contact every node", "builds in the background"}},
		{name: "drop", req: IndexRequest{Action: "drop", Name: "users_email_idx"}, want: "DROP INDEX shop.users_email_idx;"},
		{name: "drop if exists", req: IndexRequest{Action: "drop", Name: "nope", IfExists: true}, want: "DROP INDEX IF EXISTS shop.nope;"},
		{name: "drop missing", req: IndexRequest{Action: "drop", Name: "nope"}, err: "name=Index nope not found"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			v := tc.version
			if v == "" {
				v = "4.1.5"
			}
			req := tc.req
			if req.Keyspace == "" {
				req.Keyspace = "shop"
			}
			p := PlanIndex(indexSnapshot(v), req)
			if tc.err != "" {
				if p.Statement != "" || len(p.Errors) == 0 {
					t.Fatalf("want error %q, got %+v", tc.err, p)
				}
				for _, e := range p.Errors {
					if strings.Contains(e.Field+"="+e.Message, tc.err) {
						return
					}
				}
				t.Fatalf("want error %q, got %+v", tc.err, p.Errors)
			}
			if len(p.Errors) != 0 || !strings.Contains(p.Statement, tc.want) {
				t.Fatalf("want %q, got %+v", tc.want, p)
			}
			for _, n := range tc.notes {
				if !strings.Contains(strings.Join(p.Notes, "|"), n) {
					t.Errorf("missing note %q in %v", n, p.Notes)
				}
			}
		})
	}
}
