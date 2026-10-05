package schema

import (
	"fmt"
	"strings"
)

// View wizard steps (SPEC §9.19): 1 Base & columns, 2 Keys, 3 Options.
const (
	viewStepColumns = 1
	viewStepKeys    = 2
	viewStepOptions = 3

	// ViewCreate, ViewAlter and ViewDropAction are the PlanView actions.
	ViewCreate     = "create"
	ViewAlter      = "alter"
	ViewDropAction = "drop"

	viewExperimentalNote = "Materialized views are experimental in Cassandra and can drift from the base table"
)

// ViewRequest describes a materialized view to create, alter (options only) or drop.
type ViewRequest struct {
	Action    string `json:"action,omitempty"`
	Keyspace  string `json:"keyspace"`
	Name      string `json:"name"`
	BaseTable string `json:"base_table"`
	// Columns lists the selected columns; ["*"] selects all of them.
	Columns      []string          `json:"columns"`
	PartitionKey []string          `json:"partition_key"`
	Clustering   []TableClustering `json:"clustering"`
	// ExtraWhere is an optional raw restriction appended after the IS NOT NULL terms.
	ExtraWhere  string       `json:"extra_where"`
	Options     TableOptions `json:"options"`
	IfNotExists bool         `json:"if_not_exists"`
	// Alter holds the options to change for the alter action.
	Alter *AlterOptions `json:"alter,omitempty"`
}

// PlanView validates req against the snapshot and renders the view statement.
func PlanView(s *Snapshot, req ViewRequest) TablePlan {
	switch req.Action {
	case ViewAlter:
		return planAlterTable(s, TableRequest{Action: ViewOptionsAlter, Keyspace: req.Keyspace, Name: req.Name, Alter: req.Alter})
	case ViewDropAction:
		return planAlterTable(s, TableRequest{Action: ViewDrop, Keyspace: req.Keyspace, Name: req.Name})
	case "", ViewCreate:
	default:
		return TablePlan{Errors: []TablePlanError{{Field: "action", Message: fmt.Sprintf("Unknown action %s", req.Action)}}, Notes: []string{}}
	}
	p := TablePlan{Errors: []TablePlanError{}, Notes: []string{}}
	fail := func(step int, field, msg string) {
		p.Errors = append(p.Errors, TablePlanError{Step: step, Field: field, Message: msg})
	}
	note := func(msg string) { p.Notes = append(p.Notes, msg) }
	note(viewExperimentalNote)

	var ks *Keyspace
	if s != nil {
		ks = s.Keyspace(req.Keyspace)
	}
	switch {
	case ks == nil:
		fail(viewStepColumns, "keyspace", fmt.Sprintf("Keyspace %s not found", req.Keyspace))
	case ks.System:
		fail(viewStepColumns, "keyspace", fmt.Sprintf("%s is a system keyspace; views cannot be created in it", ks.Name))
	}

	switch name := req.Name; {
	case name == "":
		fail(viewStepColumns, "name", "View name is required")
	case len(name) > maxKeyspaceNameLen:
		fail(viewStepColumns, "name", fmt.Sprintf("View name must be at most %d characters", maxKeyspaceNameLen))
	case !keyspaceNameRe.MatchString(name):
		fail(viewStepColumns, "name", "Use letters, digits and underscores, starting with a letter")
	default:
		if ks != nil && nameTaken(ks, name) {
			if req.IfNotExists {
				note("A table, view or index with this name exists; nothing will change")
			} else {
				fail(viewStepColumns, "name", "A table, view or index with this name already exists")
			}
		}
		if name != strings.ToLower(name) {
			note("Case is preserved because the name contains capitals")
		}
	}

	// Base table.
	var base *Table
	switch {
	case ks == nil:
	case req.BaseTable == "":
		fail(viewStepColumns, "base_table", "Choose a base table")
	case ks.View(req.BaseTable) != nil:
		fail(viewStepColumns, "base_table", fmt.Sprintf("%s is a view; views cannot be built on views", req.BaseTable))
	default:
		if base = ks.Table(req.BaseTable); base == nil {
			fail(viewStepColumns, "base_table", fmt.Sprintf("Table %s not found in %s", req.BaseTable, ks.Name))
		} else if base.Counter {
			fail(viewStepColumns, "base_table", "Counter tables cannot have materialized views")
			base = nil
		}
	}
	if base == nil {
		if len(p.Errors) == 0 {
			fail(viewStepColumns, "base_table", "Choose a base table")
		}
		return p
	}

	colOf := map[string]*Column{}
	var baseKeys []string
	for i := range base.Columns {
		c := &base.Columns[i]
		colOf[c.Name] = c
		if c.Kind == KindPartition || c.Kind == KindClustering {
			baseKeys = append(baseKeys, c.Name)
		}
	}

	// Keys: every base key column plus at most one other column.
	inKey := map[string]bool{}
	var keyOrder []string
	addKey := func(field, name string) {
		c := colOf[name]
		switch {
		case c == nil:
			fail(viewStepKeys, field, fmt.Sprintf("Key column %s does not exist in %s", name, base.Name))
		case inKey[name]:
			fail(viewStepKeys, field, fmt.Sprintf("Column %s can be in the key only once", name))
		case c.Kind == KindStatic:
			fail(viewStepKeys, field, fmt.Sprintf("Static column %s cannot be part of a view key", name))
		default:
			inKey[name] = true
			keyOrder = append(keyOrder, name)
		}
	}
	if len(req.PartitionKey) == 0 {
		fail(viewStepKeys, "partition_key", "Choose at least one partition key column")
	}
	for i, n := range req.PartitionKey {
		addKey(fmt.Sprintf("partition_key.%d", i), n)
	}
	for i, ck := range req.Clustering {
		field := fmt.Sprintf("clustering.%d", i)
		addKey(field, ck.Column)
		if o := strings.ToUpper(ck.Order); o != "" && o != "ASC" && o != "DESC" {
			fail(viewStepKeys, field+".order", "Order must be ASC or DESC")
		}
	}
	var extras []string
	for _, n := range keyOrder {
		if c := colOf[n]; c != nil && c.Kind != KindPartition && c.Kind != KindClustering {
			extras = append(extras, n)
		}
	}
	if len(extras) > 1 {
		fail(viewStepKeys, "partition_key", fmt.Sprintf("A view can add at most one non-key column to the primary key (found %s)", strings.Join(extras, ", ")))
	}
	var missing []string
	for _, n := range baseKeys {
		if !inKey[n] {
			missing = append(missing, n)
		}
	}
	if len(missing) > 0 {
		fail(viewStepKeys, "partition_key", fmt.Sprintf("The view key must contain every base primary key column; missing %s", strings.Join(missing, ", ")))
	}

	// Selected columns.
	var selected []string
	all := len(req.Columns) == 1 && req.Columns[0] == "*"
	if all {
		for _, c := range base.Columns {
			if c.Kind == KindStatic {
				fail(viewStepColumns, "columns", fmt.Sprintf("Static column %s cannot be in a view; choose columns instead of all", c.Name))
			}
		}
	} else {
		seen := map[string]bool{}
		for i, n := range req.Columns {
			c := colOf[n]
			switch {
			case c == nil:
				fail(viewStepColumns, fmt.Sprintf("columns.%d", i), fmt.Sprintf("Column %s does not exist in %s", n, base.Name))
			case c.Kind == KindStatic:
				fail(viewStepColumns, fmt.Sprintf("columns.%d", i), fmt.Sprintf("Static column %s cannot be in a view", n))
			case !seen[n]:
				seen[n] = true
				selected = append(selected, n)
			}
		}
		var added []string
		for _, n := range keyOrder {
			if !seen[n] {
				added = append(added, n)
			}
		}
		if len(added) > 0 {
			note("Key columns added to the selection: " + strings.Join(added, ", "))
			selected = append(append([]string{}, added...), selected...)
		}
		if len(selected) == 0 {
			fail(viewStepColumns, "columns", "Select at least one column")
		}
	}

	if strings.Contains(req.ExtraWhere, ";") {
		fail(viewStepKeys, "extra_where", "The restriction cannot contain ';'")
	} else if !balancedQuotes(req.ExtraWhere) {
		fail(viewStepKeys, "extra_where", "The restriction has an unbalanced quote")
	}

	major := 0
	if s != nil {
		major = MajorVersion(s.Version)
	}
	checkTableOptions(req.Options, major, func(field, msg string) { fail(viewStepOptions, field, msg) })

	if len(p.Errors) > 0 {
		return p
	}
	p.Statement = renderView(req, base, all, selected, keyOrder)
	return p
}

// balancedQuotes reports whether every single and double quote in s is closed (” and "" escape inside).
func balancedQuotes(s string) bool {
	var open rune
	for _, r := range s {
		switch {
		case open == 0 && (r == '\'' || r == '"'):
			open = r
		case open == r:
			open = 0
		}
	}
	return open == 0
}

func renderView(req ViewRequest, base *Table, all bool, selected, keyOrder []string) string {
	var b strings.Builder
	b.WriteString("CREATE MATERIALIZED VIEW ")
	if req.IfNotExists {
		b.WriteString("IF NOT EXISTS ")
	}
	b.WriteString(qname(req.Keyspace, req.Name) + " AS\n  SELECT ")
	if all {
		b.WriteString("*")
	} else {
		ids := make([]string, len(selected))
		for i, n := range selected {
			ids[i] = Ident(n)
		}
		b.WriteString(strings.Join(ids, ", "))
	}
	b.WriteString("\n  FROM " + qname(base.Keyspace, base.Name) + "\n  WHERE ")
	terms := make([]string, len(keyOrder))
	for i, n := range keyOrder {
		terms[i] = Ident(n) + " IS NOT NULL"
	}
	if w := strings.TrimSpace(req.ExtraWhere); w != "" {
		terms = append(terms, w)
	}
	b.WriteString(strings.Join(terms, " AND "))

	pk := make([]string, len(req.PartitionKey))
	for i, n := range req.PartitionKey {
		pk[i] = Ident(n)
	}
	part := pk[0]
	if len(pk) > 1 {
		part = "(" + strings.Join(pk, ", ") + ")"
	}
	key := []string{part}
	var order []string
	desc := false
	for _, ck := range req.Clustering {
		key = append(key, Ident(ck.Column))
		o := strings.ToUpper(ck.Order)
		if o == "" {
			o = "ASC"
		}
		desc = desc || o == "DESC"
		order = append(order, Ident(ck.Column)+" "+o)
	}
	b.WriteString("\n  PRIMARY KEY (" + strings.Join(key, ", ") + ")")
	var with []string
	if desc {
		with = append(with, "CLUSTERING ORDER BY ("+strings.Join(order, ", ")+")")
	}
	with = append(with, renderOptions(req.Options)...)
	if len(with) > 0 {
		b.WriteString("\n  WITH " + strings.Join(with, " AND "))
	}
	b.WriteString(";")
	return b.String()
}
