package schema

import (
	"fmt"
	"regexp"
	"strings"
)

// Table actions other than create (SPEC §9.17).
const (
	TableAddColumn    = "add_column"
	TableDropColumn   = "drop_column"
	TableRenameColumn = "rename_column"
	TableOptionsAlter = "options"
	TableTruncate     = "truncate"
	TableDrop         = "drop"
	ViewDrop          = "drop_view"
	ViewOptionsAlter  = "alter_view"
)

var speculativeRetryRe = regexp.MustCompile(`(?i)^(NONE|ALWAYS|\d+(\.\d+)?(ms|p|percentile))$`)

// TableCaching is the caching option: keys is ALL or NONE, rows_per_partition is NONE, ALL or a number.
type TableCaching struct {
	Keys             string `json:"keys"`
	RowsPerPartition string `json:"rows_per_partition"`
}

// AlterOptions lists the options an "options" action may change. Nil fields are not touched.
type AlterOptions struct {
	Comment             *string           `json:"comment,omitempty"`
	DefaultTTLSeconds   *int              `json:"default_ttl_seconds,omitempty"`
	GCGraceSeconds      *int              `json:"gc_grace_seconds,omitempty"`
	BloomFilterFPChance *float64          `json:"bloom_filter_fp_chance,omitempty"`
	Compaction          *TableCompaction  `json:"compaction,omitempty"`
	Compression         *TableCompression `json:"compression,omitempty"`
	Caching             *TableCaching     `json:"caching,omitempty"`
	SpeculativeRetry    *string           `json:"speculative_retry,omitempty"`
	ReadRepair          *string           `json:"read_repair,omitempty"`
}

// planAlterTable plans every table action except create.
func planAlterTable(s *Snapshot, req TableRequest) TablePlan {
	p := TablePlan{Errors: []TablePlanError{}, Notes: []string{}}
	fail := func(field, msg string) { p.Errors = append(p.Errors, TablePlanError{Field: field, Message: msg}) }
	note := func(msg string) { p.Notes = append(p.Notes, msg) }

	var ks *Keyspace
	if s != nil {
		ks = s.Keyspace(req.Keyspace)
	}
	var t *Table
	switch {
	case ks == nil:
		fail("keyspace", fmt.Sprintf("Keyspace %s not found", req.Keyspace))
	case ks.System:
		fail("keyspace", "System keyspaces cannot be changed")
	case req.Action == ViewDrop:
		if ks.View(req.Name) == nil {
			fail("name", fmt.Sprintf("View %s not found in %s", req.Name, ks.Name))
		} else {
			p.Statement = fmt.Sprintf("DROP MATERIALIZED VIEW %s.%s;", Ident(ks.Name), Ident(req.Name))
		}
		return p
	case req.Action == ViewOptionsAlter:
		v := ks.View(req.Name)
		if v == nil {
			fail("name", fmt.Sprintf("View %s not found in %s", req.Name, ks.Name))
			return p
		}
		// A view's options live in the same shape as a table's, so reuse the table option planner.
		planAlterOptions(s, &Table{Keyspace: v.Keyspace, Name: v.Name, Options: v.Options}, Ident(v.Keyspace)+"."+Ident(v.Name), req.Alter, &p)
		if p.Statement != "" {
			p.Statement = strings.Replace(p.Statement, "ALTER TABLE ", "ALTER MATERIALIZED VIEW ", 1)
		}
		return p
	default:
		if t = ks.Table(req.Name); t == nil {
			fail("name", fmt.Sprintf("Table %s not found in %s", req.Name, ks.Name))
		}
	}
	if len(p.Errors) > 0 {
		return p
	}
	full := Ident(t.Keyspace) + "." + Ident(t.Name)
	col := func(name string) *Column {
		for i := range t.Columns {
			if t.Columns[i].Name == name {
				return &t.Columns[i]
			}
		}
		return nil
	}
	isKey := func(c *Column) bool { return c.Kind == KindPartition || c.Kind == KindClustering }
	indexOn := func(name string) string {
		for _, ix := range t.Indexes {
			if ix.Column == name {
				return ix.Name
			}
		}
		return ""
	}
	views := strings.Join(t.Views, ", ")

	switch req.Action {
	case TableAddColumn:
		c := req.Column
		switch {
		case c.Name == "":
			fail("column.name", "Column name is required")
		case len(c.Name) > maxKeyspaceNameLen:
			fail("column.name", fmt.Sprintf("Column name must be at most %d characters", maxKeyspaceNameLen))
		case !keyspaceNameRe.MatchString(c.Name):
			fail("column.name", "Use letters, digits and underscores, starting with a letter")
		default:
			for _, e := range t.Columns {
				if strings.EqualFold(e.Name, c.Name) {
					fail("column.name", fmt.Sprintf("Duplicate column name %s", c.Name))
				}
			}
		}
		if msg := checkColumnType(ks, c.Type, true); msg != "" {
			fail("column.type", msg)
		} else {
			isCounter := c.Type.Name == "counter"
			switch {
			case isCounter && !t.Counter:
				fail("column.type", "Counter columns can only be added to counter tables")
			case !isCounter && t.Counter:
				fail("column.type", "A counter table cannot have non-counter columns")
			}
			for _, d := range t.DroppedColumns {
				if d.Name == c.Name && !strings.EqualFold(d.Type, c.Type.String()) {
					fail("column.name", fmt.Sprintf("A column named %s was dropped with type %s; re-add it with that type or choose another name", c.Name, d.Type))
				}
			}
		}
		if c.Static {
			hasClustering := false
			for _, e := range t.Columns {
				hasClustering = hasClustering || e.Kind == KindClustering
			}
			if !hasClustering {
				fail("column.static", "Static columns need a table with clustering columns")
			}
		}
		if len(p.Errors) == 0 {
			p.Statement = fmt.Sprintf("ALTER TABLE %s ADD %s %s", full, Ident(c.Name), c.Type.String())
			if c.Static {
				p.Statement += " STATIC"
			}
			p.Statement += ";"
		}

	case TableDropColumn:
		c := col(req.Column.Name)
		switch {
		case c == nil:
			fail("column.name", fmt.Sprintf("Column %s not found", req.Column.Name))
		case isKey(c):
			fail("column.name", "Primary key columns cannot be dropped")
		case len(t.Views) > 0:
			fail("column.name", "Drop the views first: "+views)
		case indexOn(c.Name) != "":
			fail("column.name", fmt.Sprintf("Drop index %s first", indexOn(c.Name)))
		default:
			p.Statement = fmt.Sprintf("ALTER TABLE %s DROP %s;", full, Ident(c.Name))
			note("Data in this column is deleted and cannot be recovered")
		}

	case TableRenameColumn:
		c := col(req.From)
		switch {
		case c == nil:
			fail("from", fmt.Sprintf("Column %s not found", req.From))
		case !isKey(c):
			fail("from", "Cassandra can only rename primary key columns")
		case len(t.Views) > 0:
			fail("from", "Drop the views first: "+views)
		case indexOn(c.Name) != "":
			fail("from", fmt.Sprintf("Drop index %s first", indexOn(c.Name)))
		}
		switch {
		case req.To == "":
			fail("to", "New column name is required")
		case len(req.To) > maxKeyspaceNameLen:
			fail("to", fmt.Sprintf("Column name must be at most %d characters", maxKeyspaceNameLen))
		case !keyspaceNameRe.MatchString(req.To):
			fail("to", "Use letters, digits and underscores, starting with a letter")
		case col(req.To) != nil:
			fail("to", fmt.Sprintf("Duplicate column name %s", req.To))
		}
		if len(p.Errors) == 0 {
			p.Statement = fmt.Sprintf("ALTER TABLE %s RENAME %s TO %s;", full, Ident(req.From), Ident(req.To))
		}

	case TableOptionsAlter:
		planAlterOptions(s, t, full, req.Alter, &p)

	case TableTruncate:
		p.Statement = "TRUNCATE " + full + ";"
		note("Requires every node to be up")
		note("A snapshot is taken before truncating")

	case TableDrop:
		if len(t.Views) > 0 {
			fail("name", "Drop the views first: "+views)
			break
		}
		p.Statement = "DROP TABLE " + full + ";"
		if len(t.Indexes) > 0 || len(t.Triggers) > 0 {
			var parts []string
			for _, ix := range t.Indexes {
				parts = append(parts, "index "+ix.Name)
			}
			for _, tr := range t.Triggers {
				parts = append(parts, "trigger "+tr.Name)
			}
			note("Also dropped with the table: " + strings.Join(parts, ", "))
		}

	default:
		fail("action", fmt.Sprintf("Unknown action %s", req.Action))
	}
	return p
}

func optionValue(t *Table, name string) (string, bool) {
	for _, o := range t.Options {
		if o.Name == name {
			return o.Value, true
		}
	}
	return "", false
}

// planAlterOptions emits only the options whose rendered value differs from the table's current one.
func planAlterOptions(s *Snapshot, t *Table, full string, a *AlterOptions, p *TablePlan) {
	fail := func(field, msg string) {
		p.Errors = append(p.Errors, TablePlanError{Step: tableStepOptions, Field: field, Message: msg})
	}
	major := 0
	if s != nil {
		major = MajorVersion(s.Version)
	}
	var with []string
	changed := func(name, lit string) {
		if cur, ok := optionValue(t, name); !ok || cur != lit {
			with = append(with, name+" = "+lit)
		}
	}
	if a == nil {
		a = &AlterOptions{}
	}
	if v := a.Comment; v != nil {
		if len(*v) > maxTableComment {
			fail("comment", fmt.Sprintf("Comment must be at most %d characters", maxTableComment))
		}
		changed("comment", quote(*v))
	}
	if v := a.DefaultTTLSeconds; v != nil {
		switch {
		case *v < 0 || *v > maxDefaultTTL:
			fail("default_ttl_seconds", fmt.Sprintf("Default TTL must be between 0 and %d seconds", maxDefaultTTL))
		case *v > 0 && t.Counter:
			fail("default_ttl_seconds", tableCounterError)
		}
		changed("default_time_to_live", fmt.Sprint(*v))
	}
	if v := a.GCGraceSeconds; v != nil {
		if *v < 0 {
			fail("gc_grace_seconds", "gc_grace_seconds must be at least 0")
		}
		changed("gc_grace_seconds", fmt.Sprint(*v))
	}
	if v := a.BloomFilterFPChance; v != nil {
		if *v <= 0 || *v > 1 {
			fail("bloom_filter_fp_chance", "Bloom filter false-positive chance must be above 0 and at most 1")
		}
		changed("bloom_filter_fp_chance", literalFloat(*v, 64))
	}
	if v := a.Compaction; v != nil {
		switch v.Class {
		case "", CompactionSTCS, CompactionLCS, CompactionTWCS:
		case CompactionUCS:
			if major < 5 {
				fail("compaction", "UnifiedCompactionStrategy needs server 5.0 or later")
			}
		default:
			fail("compaction", fmt.Sprintf("Unknown compaction strategy %s", v.Class))
		}
		if v.Class != "" {
			cur, _ := optionValue(t, "compaction")
			if len(v.Params) > 0 || !strings.Contains(cur, "."+v.Class+"'") && !strings.Contains(cur, "'"+v.Class+"'") {
				m := map[string]string{"class": v.Class}
				for k, pv := range v.Params {
					m[k] = pv
				}
				with = append(with, "compaction = "+literalMap(m))
			}
		}
	}
	if v := a.Compression; v != nil && v.Class != "" {
		cur, _ := optionValue(t, "compression")
		if v.Class == CompressionNone {
			if !strings.Contains(cur, "'enabled': 'false'") {
				with = append(with, "compression = {'enabled': false}")
			}
		} else if min, ok := compressors[v.Class]; !ok {
			fail("compression", fmt.Sprintf("Unknown compressor %s", v.Class))
		} else if major < min {
			fail("compression", fmt.Sprintf("%s needs server %d.0 or later", v.Class, min))
		} else if !strings.Contains(cur, "."+v.Class+"'") && !strings.Contains(cur, "'"+v.Class+"'") {
			with = append(with, "compression = "+literalMap(map[string]string{"class": v.Class}))
		}
	}
	if v := a.Caching; v != nil {
		keys, rows := strings.ToUpper(v.Keys), strings.ToUpper(v.RowsPerPartition)
		if keys != "ALL" && keys != "NONE" {
			fail("caching.keys", "Keys must be ALL or NONE")
		}
		if n := strings.Trim(rows, "0123456789"); rows != "NONE" && rows != "ALL" && (rows == "" || n != "") {
			fail("caching.rows_per_partition", "Rows per partition must be NONE, ALL or a number")
		}
		changed("caching", literalMap(map[string]string{"keys": keys, "rows_per_partition": rows}))
	}
	if v := a.SpeculativeRetry; v != nil {
		if !speculativeRetryRe.MatchString(*v) {
			fail("speculative_retry", "Use NONE, ALWAYS, a percentile such as 99p, or a time such as 50ms")
		}
		changed("speculative_retry", quote(*v))
	}
	if v := a.ReadRepair; v != nil {
		rr := strings.ToUpper(*v)
		switch {
		case major < 4:
			fail("read_repair", "read_repair needs server 4.0 or later")
		case rr != "BLOCKING" && rr != "NONE":
			fail("read_repair", "read_repair must be BLOCKING or NONE")
		}
		changed("read_repair", quote(rr))
	}
	if len(p.Errors) > 0 {
		return
	}
	if len(with) == 0 {
		p.Errors = append(p.Errors, TablePlanError{Message: "Nothing to change"})
		return
	}
	p.Statement = "ALTER TABLE " + full + " WITH " + strings.Join(with, " AND ") + ";"
	if a.Compaction != nil && a.Compaction.Class == CompactionTWCS {
		if v := a.DefaultTTLSeconds; v == nil || *v == 0 {
			p.Notes = append(p.Notes, "Time-window compaction works best with a default TTL")
		}
	}
}
