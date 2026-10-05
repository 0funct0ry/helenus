package schema

import (
	"fmt"
	"strings"
)

// Index kinds and targets accepted by PlanIndex (SPEC §9.18).
const (
	IndexCreate = "create"
	IndexDrop   = "drop"

	IndexKindLegacy = "legacy"
	IndexKindSAI    = "sai"

	IndexTargetPlain   = "plain"
	IndexTargetValues  = "VALUES"
	IndexTargetKeys    = "KEYS"
	IndexTargetEntries = "ENTRIES"
	IndexTargetFull    = "FULL"
)

// IndexOptions are the SAI WITH OPTIONS settings; unset values mean the server default.
type IndexOptions struct {
	CaseSensitive      *bool  `json:"case_sensitive,omitempty"`
	Normalize          *bool  `json:"normalize,omitempty"`
	ASCII              *bool  `json:"ascii,omitempty"`
	SimilarityFunction string `json:"similarity_function,omitempty"`
}

func (o IndexOptions) empty() bool {
	return o.CaseSensitive == nil && o.Normalize == nil && o.ASCII == nil && o.SimilarityFunction == ""
}

func (o IndexOptions) textOnly() bool {
	return o.CaseSensitive != nil || o.Normalize != nil || o.ASCII != nil
}

// IndexRequest describes an index to create (Table, Column, Target, Kind, Options) or drop (Name).
type IndexRequest struct {
	Action      string       `json:"action"`
	Keyspace    string       `json:"keyspace"`
	Table       string       `json:"table"`
	Name        string       `json:"name"`
	Column      string       `json:"column"`
	Target      string       `json:"target"`
	Kind        string       `json:"kind"`
	Options     IndexOptions `json:"options"`
	IfNotExists bool         `json:"if_not_exists"`
	IfExists    bool         `json:"if_exists"`
}

// IndexPlan is the result of planning an index change: the statement (empty when there are errors),
// the blocking errors, and non-blocking notes.
type IndexPlan = KeyspacePlan

// DefaultIndexName is the name offered when the user leaves the name empty.
func DefaultIndexName(table, column string) string { return table + "_" + column + "_idx" }

// IndexTargets lists the valid targets for a column type, default first.
func IndexTargets(t Column) []string {
	switch t.Type.Name {
	case "list", "set":
		if t.Type.Frozen {
			return []string{IndexTargetFull}
		}
		return []string{IndexTargetValues}
	case "map":
		if t.Type.Frozen {
			return []string{IndexTargetFull}
		}
		return []string{IndexTargetValues, IndexTargetKeys, IndexTargetEntries}
	case "tuple":
		return []string{IndexTargetFull}
	}
	if t.Type.UDT != nil {
		return []string{IndexTargetFull}
	}
	return []string{IndexTargetPlain}
}

func indexTargetOf(ix Index) string {
	i := strings.Index(ix.Target, "(")
	if i < 0 {
		return IndexTargetPlain
	}
	return strings.ToUpper(ix.Target[:i])
}

// PlanIndex validates req against the snapshot and renders CREATE INDEX or DROP INDEX.
func PlanIndex(s *Snapshot, req IndexRequest) IndexPlan {
	p := IndexPlan{Errors: []PlanError{}, Notes: []string{}}
	fail := func(field, msg string) { p.Errors = append(p.Errors, PlanError{Field: field, Message: msg}) }
	note := func(msg string) { p.Notes = append(p.Notes, msg) }

	var ks *Keyspace
	if s != nil {
		ks = s.Keyspace(req.Keyspace)
	}
	if ks == nil {
		fail("keyspace", fmt.Sprintf("Keyspace %s not found", req.Keyspace))
		return p
	}
	if ks.System {
		fail("keyspace", fmt.Sprintf("%s is a system keyspace; its indexes cannot be changed", ks.Name))
		return p
	}

	if req.Action == IndexDrop {
		found := false
		for _, t := range ks.Tables {
			for _, ix := range t.Indexes {
				found = found || ix.Name == req.Name
			}
		}
		switch {
		case req.Name == "":
			fail("name", "Index name is required")
		case !found && !req.IfExists:
			fail("name", fmt.Sprintf("Index %s not found", req.Name))
		}
		if len(p.Errors) == 0 {
			stmt := "DROP INDEX "
			if req.IfExists {
				stmt += "IF EXISTS "
			}
			p.Statement = stmt + qname(ks.Name, req.Name) + ";"
		}
		return p
	}

	major := 0
	if s != nil {
		major = MajorVersion(s.Version)
	}
	sai := req.Kind == IndexKindSAI
	if req.Kind != "" && req.Kind != IndexKindSAI && req.Kind != IndexKindLegacy {
		fail("kind", "Kind must be legacy or sai")
	}
	if sai && major < 5 {
		fail("kind", "SAI needs server 5.0 or later")
	}

	t := ks.Table(req.Table)
	if t == nil {
		fail("table", fmt.Sprintf("Table %s not found", req.Table))
		return p
	}
	var col *Column
	for i := range t.Columns {
		if t.Columns[i].Name == req.Column {
			col = &t.Columns[i]
		}
	}
	if col == nil {
		fail("column", fmt.Sprintf("Column %s does not exist", req.Column))
		return p
	}

	// Name.
	name := req.Name
	if name == "" {
		name = DefaultIndexName(t.Name, col.Name)
	}
	switch {
	case len(name) > maxKeyspaceNameLen:
		fail("name", fmt.Sprintf("Index name must be at most %d characters", maxKeyspaceNameLen))
	case !keyspaceNameRe.MatchString(name):
		fail("name", "Use letters, digits and underscores, starting with a letter")
	case nameTaken(ks, name):
		if req.IfNotExists {
			note("A table, view or index with this name exists; nothing will change")
		} else {
			fail("name", "A table, view or index with this name already exists")
		}
	}

	// Column rules.
	isVector := col.Type.Name == "vector"
	partCols := 0
	for _, c := range t.Columns {
		if c.Kind == KindPartition {
			partCols++
		}
	}
	switch {
	case col.Type.Name == "counter":
		fail("column", "Counter columns cannot be indexed")
	case isVector && !sai:
		fail("kind", "Vector columns need an SAI index")
	case !sai && col.Kind == KindPartition && partCols == 1:
		fail("column", "The only partition key column cannot have a legacy index")
	}

	// Target.
	target := req.Target
	valid := IndexTargets(*col)
	if isVector {
		valid = []string{IndexTargetPlain}
	}
	if target == "" {
		target = valid[0]
	}
	okTarget := false
	for _, v := range valid {
		okTarget = okTarget || v == target
	}
	if !okTarget {
		fail("target", fmt.Sprintf("%s cannot be indexed with %s; use %s", col.Name, target, strings.Join(valid, ", ")))
	}
	for _, ix := range t.Indexes {
		if ix.Column == col.Name && indexTargetOf(ix) == target {
			fail("column", fmt.Sprintf("Index %s already covers this column and target", ix.Name))
		}
	}

	// Options.
	opts := map[string]string{}
	textCol := col.Type.Name == "text" || col.Type.Name == "varchar" || col.Type.Name == "ascii"
	if !req.Options.empty() && !sai {
		fail("options", "Options are only available on SAI indexes")
	}
	if sai {
		if req.Options.textOnly() && !textCol {
			fail("options", "Text options only apply to text, varchar and ascii columns")
		}
		for k, v := range map[string]*bool{"case_sensitive": req.Options.CaseSensitive, "normalize": req.Options.Normalize, "ascii": req.Options.ASCII} {
			if v != nil {
				opts[k] = fmt.Sprint(*v)
			}
		}
		if f := req.Options.SimilarityFunction; f != "" {
			switch {
			case !isVector:
				fail("options.similarity_function", "similarity_function only applies to vector columns")
			case f != "cosine" && f != "dot_product" && f != "euclidean":
				fail("options.similarity_function", "similarity_function must be cosine, dot_product or euclidean")
			default:
				opts["similarity_function"] = f
			}
		}
	}

	if !sai {
		switch col.Type.Name {
		case "uuid", "timeuuid", "timestamp":
			note("Queries using this index contact every node; consider SAI or a new table")
		}
	}
	note("Index builds in the background; queries may miss rows until it finishes")

	if len(p.Errors) > 0 {
		return p
	}
	stmt := "CREATE INDEX "
	if req.IfNotExists {
		stmt += "IF NOT EXISTS "
	}
	tgt := Ident(col.Name)
	if target != IndexTargetPlain {
		tgt = target + "(" + tgt + ")"
	}
	stmt += Ident(name) + " ON " + qname(ks.Name, t.Name) + " (" + tgt + ")"
	if sai {
		stmt += " USING 'sai'"
		if len(opts) > 0 {
			stmt += " WITH OPTIONS = " + literalMap(opts)
		}
	}
	p.Statement = stmt + ";"
	return p
}
