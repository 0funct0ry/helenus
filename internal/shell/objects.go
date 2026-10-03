package shell

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/0funct0ry/helenus/internal/schema"
)

// objectLists maps each listing command to its object noun and builder.
var objectLists = map[string]struct {
	noun  string
	build func(ks *schema.Keyspace) ([]string, [][]string)
}{
	".tables":     {"tables", tableRows},
	".views":      {"materialized views", viewRows},
	".types":      {"user-defined types", typeRows},
	".functions":  {"user-defined functions", functionRows},
	".aggregates": {"user-defined aggregates", aggregateRows},
	".indexes":    {"indexes", indexRows},
	".triggers":   {"triggers", triggerRows},
}

// listObjects implements .tables, .views, .types, .functions, .aggregates, .indexes and .triggers: one
// table of the objects in the current keyspace.
func (s *Shell) listObjects(ctx context.Context, cmd string, args []string) error {
	if len(args) > 0 {
		return syntaxErr("usage: " + cmd + " (lists the objects in the current keyspace)")
	}
	if s.Keyspace == "" {
		return errors.New("no keyspace selected; run .use <keyspace> first")
	}
	if s.Schema == nil {
		return errors.New("not connected")
	}
	snap, err := s.Schema(ctx)
	if err != nil {
		return err
	}
	ks := snap.Keyspace(s.Keyspace)
	if ks == nil {
		return fmt.Errorf("keyspace %q does not exist; run .use <keyspace> to pick another", s.Keyspace)
	}
	def := objectLists[cmd]
	head, rows := def.build(ks)
	if len(rows) == 0 {
		fmt.Fprintf(s.Out, "No %s in keyspace %s.\n", def.noun, ks.Name)
		return nil
	}
	s.printTable(head, rows)
	s.footer(fmt.Sprintf("(%d %s in %s)", len(rows), plural1(len(rows), strings.TrimSuffix(def.noun, "s")), ks.Name))
	return nil
}

func keyNames(cols []schema.Column, kind string) string {
	var parts []string
	for _, c := range cols {
		if c.Kind == kind {
			parts = append(parts, c.Name)
		}
	}
	return strings.Join(parts, ", ")
}

func tableRows(ks *schema.Keyspace) ([]string, [][]string) {
	var rows [][]string
	for _, t := range ks.Tables {
		kind := "table"
		if t.Counter {
			kind = "counter"
		}
		rows = append(rows, []string{t.Name, kind, strconv.Itoa(len(t.Columns)), keyNames(t.Columns, schema.KindPartition), keyNames(t.Columns, schema.KindClustering), strconv.Itoa(len(t.Indexes)), strconv.Itoa(len(t.Views))})
	}
	return []string{"name", "kind", "columns", "partition key", "clustering key", "indexes", "views"}, rows
}

func viewRows(ks *schema.Keyspace) ([]string, [][]string) {
	var rows [][]string
	for _, v := range ks.Views {
		rows = append(rows, []string{v.Name, v.BaseTable, strconv.Itoa(len(v.Columns)), keyNames(v.Columns, schema.KindPartition), keyNames(v.Columns, schema.KindClustering)})
	}
	return []string{"name", "base table", "columns", "partition key", "clustering key"}, rows
}

func typeRows(ks *schema.Keyspace) ([]string, [][]string) {
	var rows [][]string
	for _, u := range ks.Types {
		names := make([]string, len(u.Fields))
		for i, f := range u.Fields {
			names[i] = f.Name
		}
		rows = append(rows, []string{u.Name, strings.Join(names, ", "), strconv.Itoa(len(u.UsedBy))})
	}
	return []string{"name", "fields", "used by"}, rows
}

func functionRows(ks *schema.Keyspace) ([]string, [][]string) {
	var rows [][]string
	for _, f := range ks.Functions {
		null := "RETURNS NULL ON NULL INPUT"
		if f.CalledOnNull {
			null = "CALLED ON NULL INPUT"
		}
		rows = append(rows, []string{f.Signature(), f.ReturnType, f.Language, null})
	}
	return []string{"signature", "returns", "language", "null handling"}, rows
}

func aggregateRows(ks *schema.Keyspace) ([]string, [][]string) {
	var rows [][]string
	for _, a := range ks.Aggregates {
		rows = append(rows, []string{a.Signature(), a.ReturnType, a.StateFunc, a.StateType, a.FinalFunc})
	}
	return []string{"signature", "returns", "state function", "state type", "final function"}, rows
}

func triggerRows(ks *schema.Keyspace) ([]string, [][]string) {
	var rows [][]string
	for _, t := range ks.Tables {
		for _, tr := range t.Triggers {
			rows = append(rows, []string{tr.Name, t.Name, tr.Class})
		}
	}
	return []string{"name", "table", "class"}, rows
}

func indexRows(ks *schema.Keyspace) ([]string, [][]string) {
	var rows [][]string
	for _, t := range ks.Tables {
		for _, ix := range t.Indexes {
			kind := ix.Kind
			if ix.SAI {
				kind = "SAI"
			}
			rows = append(rows, []string{ix.Name, t.Name, kind, ix.Target})
		}
	}
	return []string{"name", "table", "kind", "target"}, rows
}
