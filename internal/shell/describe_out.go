package shell

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/0funct0ry/helenus/internal/schema"
)

// describe implements .describe. The list forms (keyspaces, tables, types, functions,
// aggregates) and cluster print tables; every other form prints DDL with syntax highlighting.
func (s *Shell) describe(ctx context.Context, stmt string) error {
	t, err := schema.ParseDescribe(stmt)
	if err != nil {
		return syntaxErr(err.Error())
	}
	if s.Describer == nil {
		return fmt.Errorf("not connected")
	}
	switch t.Kind {
	case schema.Keyspaces, schema.Tables, schema.Types, schema.Functions, schema.Aggregates:
		if s.Schema != nil {
			if snap, err := s.Schema(ctx); err == nil {
				s.describeList(t.Kind, snap)
				return nil
			}
		}
	}
	out, err := s.Describer.Describe(ctx, t, s.Keyspace)
	if err != nil {
		return err
	}
	if t.Kind == schema.Cluster && s.printProperties(out) {
		return nil
	}
	s.code(out)
	return nil
}

// printProperties turns "Name: value" lines into a two-column table. It reports false when the
// text is not in that form.
func (s *Shell) printProperties(text string) bool {
	var rows [][]string
	for _, line := range strings.Split(text, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		k, v, ok := strings.Cut(line, ": ")
		if !ok {
			return false
		}
		rows = append(rows, []string{k, v})
	}
	if len(rows) == 0 {
		return false
	}
	s.printTable([]string{"property", "value"}, rows)
	return true
}

// replicationSummary renders a replication map as "Simple · 3" or "NTS · dc1:3, dc2:2".
func replicationSummary(r map[string]string) string {
	cls := r["class"]
	if i := strings.LastIndex(cls, "."); i >= 0 {
		cls = cls[i+1:]
	}
	switch cls {
	case "SimpleStrategy":
		return "Simple · " + r["replication_factor"]
	case "NetworkTopologyStrategy":
		var parts []string
		for dc, n := range r {
			if dc != "class" {
				parts = append(parts, dc+":"+n)
			}
		}
		sort.Strings(parts)
		return "NTS · " + strings.Join(parts, ", ")
	}
	return strings.TrimSuffix(cls, "Strategy")
}

func (s *Shell) describeList(kind schema.TargetKind, snap *schema.Snapshot) {
	var head []string
	var rows [][]string
	noun := ""
	for _, k := range snap.Keyspaces {
		switch kind {
		case schema.Keyspaces:
			noun = "keyspace"
			head = []string{"keyspace", "replication", "durable writes", "tables", "views", "types", "functions"}
			rows = append(rows, []string{k.Name, replicationSummary(k.Replication), strconv.FormatBool(k.DurableWrites),
				strconv.Itoa(len(k.Tables)), strconv.Itoa(len(k.Views)), strconv.Itoa(len(k.Types)), strconv.Itoa(len(k.Functions) + len(k.Aggregates))})
		case schema.Tables:
			noun = "table"
			head = []string{"keyspace", "name", "kind", "columns", "partition key", "clustering key"}
			for _, t := range k.Tables {
				kind := "table"
				if t.Counter {
					kind = "counter"
				}
				rows = append(rows, []string{k.Name, t.Name, kind, strconv.Itoa(len(t.Columns)), keyNames(t.Columns, schema.KindPartition), keyNames(t.Columns, schema.KindClustering)})
			}
			for _, v := range k.Views {
				rows = append(rows, []string{k.Name, v.Name, "view", strconv.Itoa(len(v.Columns)), keyNames(v.Columns, schema.KindPartition), keyNames(v.Columns, schema.KindClustering)})
			}
		case schema.Types:
			noun = "type"
			head = []string{"keyspace", "name", "fields"}
			for _, u := range k.Types {
				names := make([]string, len(u.Fields))
				for i, f := range u.Fields {
					names[i] = f.Name
				}
				rows = append(rows, []string{k.Name, u.Name, strings.Join(names, ", ")})
			}
		case schema.Functions:
			noun = "function"
			head = []string{"keyspace", "signature", "returns", "language"}
			for _, f := range k.Functions {
				rows = append(rows, []string{k.Name, f.Signature(), f.ReturnType, f.Language})
			}
		case schema.Aggregates:
			noun = "aggregate"
			head = []string{"keyspace", "signature", "returns", "state function"}
			for _, a := range k.Aggregates {
				rows = append(rows, []string{k.Name, a.Signature(), a.ReturnType, a.StateFunc})
			}
		}
	}
	if len(rows) == 0 {
		fmt.Fprintf(s.Out, "No %ss.\n", noun)
		return
	}
	s.printTable(head, rows)
	s.footer(fmt.Sprintf("(%d %s)", len(rows), plural1(len(rows), noun)))
}
