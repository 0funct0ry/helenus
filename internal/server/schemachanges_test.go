package server

import (
	"encoding/json"
	"errors"
	"io"
	"path/filepath"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/require"

	"github.com/0funct0ry/helenus/internal/schema"
	"github.com/0funct0ry/helenus/internal/store"
)

const twoProfiles = "profiles:\n  local:\n    hosts: [127.0.0.1]\n  other:\n    hosts: [127.0.0.2]\n"

func newChangesEnv(t *testing.T) *env {
	t.Helper()
	e := newEnv(t, twoProfiles)
	st, err := store.Open(filepath.Join(t.TempDir(), "h.db"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = st.Close() })
	e.fc.snap = &schema.Snapshot{Keyspaces: []schema.Keyspace{{Name: "shop", Tables: []schema.Table{{
		Keyspace: "shop", Name: "users",
		Columns: []schema.Column{{Name: "id", CQL: "uuid", Kind: schema.KindPartition}},
		Options: []schema.Option{{Name: "gc_grace_seconds", Value: "864000"}},
	}}}}}
	e.h = NewRouter(Options{
		Stderr: io.Discard, ConfigPath: e.cfg, DataDir: e.data, Connector: e.fc, Store: st,
		Assets: fstest.MapFS{"index.html": {Data: []byte("x")}},
	})
	for _, p := range []string{"local", "other"} {
		e.do("POST", "/api/v1/p/"+p+"/connect", "")
	}
	return e
}

type changesPage struct {
	Items []struct {
		ID          int64  `json:"id"`
		Action      string `json:"action"`
		ObjectName  string `json:"object_name"`
		Statement   string `json:"statement"`
		Reverse     string `json:"reverse"`
		ReverseNote string `json:"reverse_note"`
		Status      string `json:"status"`
		Error       string `json:"error"`
	} `json:"items"`
	NextBefore *int64 `json:"next_before"`
}

func (e *env) changes(t *testing.T, profile, query string) changesPage {
	t.Helper()
	rec := e.do("GET", "/api/v1/p/"+profile+"/schema-changes"+query, "")
	require.Equal(t, 200, rec.Code, rec.Body.String())
	var out changesPage
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	return out
}

func TestSchemaChangesRecordsUIDDLOnly(t *testing.T) {
	e := newChangesEnv(t)
	e.do("POST", "/api/v1/p/local/query", `{"cql":"CREATE TYPE shop.addr (a text)","keyspace":"shop","ddl_origin":"ui"}`)
	e.do("POST", "/api/v1/p/local/query", `{"cql":"CREATE TYPE shop.typed (a text)","keyspace":"shop"}`)
	e.do("POST", "/api/v1/p/local/query", `{"cql":"SELECT * FROM shop.users","keyspace":"shop","ddl_origin":"ui"}`)
	got := e.changes(t, "local", "")
	require.Len(t, got.Items, 1)
	require.Equal(t, "ok", got.Items[0].Status)
	require.Equal(t, "DROP TYPE shop.addr;", got.Items[0].Reverse)
	require.Empty(t, e.changes(t, "other", "").Items, "history is per profile")
}

func TestSchemaChangesRecordsFailureWithoutReverse(t *testing.T) {
	e := newChangesEnv(t)
	e.fc.queryErr = errors.New("already exists")
	e.do("POST", "/api/v1/p/local/query", `{"cql":"CREATE TABLE shop.users (id int PRIMARY KEY)","ddl_origin":"ui"}`)
	got := e.changes(t, "local", "")
	require.Len(t, got.Items, 1)
	require.Equal(t, "error", got.Items[0].Status)
	require.Equal(t, "already exists", got.Items[0].Error)
	require.Empty(t, got.Items[0].Reverse)
}

func TestSchemaChangesOptionReverseAndMasking(t *testing.T) {
	e := newChangesEnv(t)
	e.do("POST", "/api/v1/p/local/query", `{"cql":"ALTER TABLE shop.users WITH gc_grace_seconds = 3600","ddl_origin":"ui"}`)
	e.do("POST", "/api/v1/p/local/query", `{"cql":"CREATE ROLE bob WITH PASSWORD = 's3cret' AND LOGIN = true","ddl_origin":"ui"}`)
	rec := e.do("GET", "/api/v1/p/local/schema-changes", "")
	require.NotContains(t, rec.Body.String(), "s3cret")
	got := e.changes(t, "local", "")
	require.Len(t, got.Items, 2)
	require.Contains(t, got.Items[0].Statement, "'••••••'")
	require.Equal(t, "DROP ROLE bob;", got.Items[0].Reverse)
	require.Equal(t, "ALTER TABLE shop.users WITH gc_grace_seconds = 864000;", got.Items[1].Reverse)
}

func TestSchemaChangesPagingSearchAndClear(t *testing.T) {
	e := newChangesEnv(t)
	for _, n := range []string{"a", "b", "c"} {
		e.do("POST", "/api/v1/p/local/query", `{"cql":"CREATE TYPE shop.`+n+` (x int)","ddl_origin":"ui"}`)
	}
	e.do("POST", "/api/v1/p/other/query", `{"cql":"CREATE TYPE shop.z (x int)","ddl_origin":"ui"}`)
	page := e.changes(t, "local", "?limit=2")
	require.Len(t, page.Items, 2)
	require.Equal(t, "c", page.Items[0].ObjectName)
	require.NotNil(t, page.NextBefore)
	rest := e.changes(t, "local", "?limit=2&before="+jsonInt(*page.NextBefore))
	require.Len(t, rest.Items, 1)
	require.Nil(t, rest.NextBefore)
	require.Len(t, e.changes(t, "local", "?q=TYPE%20shop.b").Items, 1)

	require.Equal(t, 200, e.do("DELETE", "/api/v1/p/local/schema-changes", "").Code)
	require.Empty(t, e.changes(t, "local", "").Items)
	require.Len(t, e.changes(t, "other", "").Items, 1)
}

func jsonInt(n int64) string {
	b, _ := json.Marshal(n)
	return string(b)
}
