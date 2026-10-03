package cql

import (
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/stretchr/testify/require"
)

var update = flag.Bool("update", false, "rewrite golden files")

func TestSplitGolden(t *testing.T) {
	files, err := filepath.Glob("testdata/split/*.cql")
	require.NoError(t, err)
	require.NotEmpty(t, files)
	for _, f := range files {
		t.Run(strings.TrimSuffix(filepath.Base(f), ".cql"), func(t *testing.T) {
			in, err := os.ReadFile(f)
			require.NoError(t, err)
			stmts := Split(string(in))
			got, err := json.MarshalIndent(stmts, "", "  ")
			require.NoError(t, err)
			got = append(got, '\n')
			golden := strings.TrimSuffix(f, ".cql") + ".golden"
			if *update {
				require.NoError(t, os.WriteFile(golden, got, 0o644))
			}
			want, err := os.ReadFile(golden)
			require.NoError(t, err)
			require.Equal(t, string(want), string(got))
			for _, s := range stmts {
				require.LessOrEqual(t, s.End, len(in))
			}
		})
	}
}

func TestSplitProperties(t *testing.T) {
	s := Split("SELECT 1; SELECT 'a;b';")
	require.Len(t, s, 2)
	require.Equal(t, "SELECT 1;", s[0].Text)
	require.Equal(t, 0, s[0].Start)
	require.Equal(t, 9, s[0].End)
	require.True(t, s[1].Complete)
	s = Split("a\nb;\n\nSELECT 2")
	require.Equal(t, 1, s[0].Line)
	require.Equal(t, 4, s[1].Line)
	require.False(t, s[1].Complete)
}

func TestQuoteIdent(t *testing.T) {
	for in, want := range map[string]string{
		"users": "users", "Users": `"Users"`, "select": `"select"`, "a-b": `"a-b"`, "1a": `"1a"`, `a"b`: `"a""b"`, "snake_case9": "snake_case9",
	} {
		require.Equal(t, want, QuoteIdent(in), in)
	}
}

func TestAllowFiltering(t *testing.T) {
	require.Equal(t, "SELECT * FROM t LIMIT 5 ALLOW FILTERING;", AppendAllowFiltering("SELECT * FROM t LIMIT 5;"))
	require.Equal(t, "SELECT * FROM t ALLOW FILTERING", AppendAllowFiltering("SELECT * FROM t"))
	require.Equal(t, "SELECT * FROM t allow filtering;", AppendAllowFiltering("SELECT * FROM t allow filtering;"))
	require.Equal(t, "DELETE FROM t WHERE a=1;", AppendAllowFiltering("DELETE FROM t WHERE a=1;"))
	require.True(t, HasIF("INSERT INTO t(a) VALUES(1) IF NOT EXISTS;"))
	require.False(t, HasIF("INSERT INTO t(a) VALUES('IF');"))
}

func TestRenderLiteral(t *testing.T) {
	require.Equal(t, "'it''s'", RenderLiteral("it's", codec.TypeDesc{Name: "text"}))
	require.Equal(t, "42", RenderLiteral(int32(42), codec.TypeDesc{Name: "int"}))
	require.Equal(t, "null", RenderLiteral(nil, codec.TypeDesc{Name: "int"}))
	require.Equal(t, "{'a': 1}", RenderLiteral(map[string]int32{"a": 1}, codec.TypeDesc{Name: "map", Args: []codec.TypeDesc{{Name: "text"}, {Name: "int"}}}))
	require.Equal(t, "'2026-09-30'", RenderLiteral(time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC), codec.TypeDesc{Name: "date"}))
}

func TestSplitSlashCommandTakesWholeLine(t *testing.T) {
	got := Split(".alias a = SELECT 'x;y' -- keep\n:a 1;\nSELECT 1;")
	want := []string{".alias a = SELECT 'x;y' -- keep", ":a 1;", "SELECT 1;"}
	if len(got) != len(want) {
		t.Fatalf("got %+v", got)
	}
	for i, w := range want {
		if got[i].Text != w {
			t.Errorf("stmt %d = %q, want %q", i, got[i].Text, w)
		}
	}
}
