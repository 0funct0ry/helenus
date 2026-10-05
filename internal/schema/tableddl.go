package schema

import (
	"fmt"
	"strings"

	"github.com/0funct0ry/helenus/internal/codec"
)

// Compaction strategies and compressors a new table can use (SPEC §9.13).
const (
	CompactionSTCS    = "SizeTieredCompactionStrategy"
	CompactionLCS     = "LeveledCompactionStrategy"
	CompactionTWCS    = "TimeWindowCompactionStrategy"
	CompactionUCS     = "UnifiedCompactionStrategy"
	CompressionLZ4    = "LZ4Compressor"
	CompressionNone   = "none"
	defaultGCGrace    = 864000
	defaultBloomFP    = 0.01
	maxDefaultTTL     = 630720000
	maxTableComment   = 1024
	tableStepColumns  = 1
	tableStepKeys     = 2
	tableStepOptions  = 3
	tableCounterError = "A counter table may not set a default TTL above 0"
)

var compressors = map[string]int{ // compressor -> minimum server major version
	"LZ4Compressor": 0, "SnappyCompressor": 0, "DeflateCompressor": 0, "ZstdCompressor": 4,
}

// TableColumn is one column of a table to create.
type TableColumn struct {
	Name   string         `json:"name"`
	Type   codec.TypeDesc `json:"type"`
	Static bool           `json:"static"`
}

// TableClustering is one clustering column with its order ("ASC" or "DESC"; empty means ASC).
type TableClustering struct {
	Column string `json:"column"`
	Order  string `json:"order"`
}

// TableCompaction selects a compaction strategy; Params are extra sub-options.
type TableCompaction struct {
	Class  string            `json:"class"`
	Params map[string]string `json:"params,omitempty"`
}

// TableCompression selects a compressor, or "none" to disable compression.
type TableCompression struct {
	Class string `json:"class"`
}

// TableOptions holds the optional WITH settings; unset values mean the server default.
type TableOptions struct {
	Comment             string           `json:"comment"`
	DefaultTTLSeconds   int              `json:"default_ttl_seconds"`
	GCGraceSeconds      *int             `json:"gc_grace_seconds"`
	Compaction          TableCompaction  `json:"compaction"`
	Compression         TableCompression `json:"compression"`
	BloomFilterFPChance *float64         `json:"bloom_filter_fp_chance"`
}

// TableRequest describes a table to create.
type TableRequest struct {
	Keyspace     string            `json:"keyspace"`
	Name         string            `json:"name"`
	IfNotExists  bool              `json:"if_not_exists"`
	Columns      []TableColumn     `json:"columns"`
	PartitionKey []string          `json:"partition_key"`
	Clustering   []TableClustering `json:"clustering"`
	Options      TableOptions      `json:"options"`
}

// TablePlanError is a validation problem tied to a wizard step (1 Columns, 2 Keys, 3 Options) and a field.
type TablePlanError struct {
	Step    int    `json:"step"`
	Field   string `json:"field"`
	Message string `json:"message"`
}

// TablePlan is the result of planning a table creation: the statement (empty when there are errors),
// the blocking errors, and non-blocking notes.
type TablePlan struct {
	Statement string           `json:"statement"`
	Errors    []TablePlanError `json:"errors"`
	Notes     []string         `json:"notes"`
}

// PlanTable validates req against the snapshot and renders CREATE TABLE.
func PlanTable(s *Snapshot, req TableRequest) TablePlan {
	p := TablePlan{Errors: []TablePlanError{}, Notes: []string{}}
	fail := func(step int, field, msg string) {
		p.Errors = append(p.Errors, TablePlanError{Step: step, Field: field, Message: msg})
	}
	note := func(msg string) { p.Notes = append(p.Notes, msg) }

	var ks *Keyspace
	if s != nil {
		ks = s.Keyspace(req.Keyspace)
	}
	switch {
	case ks == nil:
		fail(tableStepColumns, "keyspace", fmt.Sprintf("Keyspace %s not found", req.Keyspace))
	case ks.System:
		fail(tableStepColumns, "keyspace", fmt.Sprintf("%s is a system keyspace; tables cannot be created in it", ks.Name))
	}

	// Table name.
	switch name := req.Name; {
	case name == "":
		fail(tableStepColumns, "name", "Table name is required")
	case len(name) > maxKeyspaceNameLen:
		fail(tableStepColumns, "name", fmt.Sprintf("Table name must be at most %d characters", maxKeyspaceNameLen))
	case !keyspaceNameRe.MatchString(name):
		fail(tableStepColumns, "name", "Use letters, digits and underscores, starting with a letter")
	default:
		if ks != nil && nameTaken(ks, name) {
			if req.IfNotExists {
				note("A table, view or index with this name exists; nothing will change")
			} else {
				fail(tableStepColumns, "name", "A table, view or index with this name already exists")
			}
		}
		if name != strings.ToLower(name) {
			note("Case is preserved because the name contains capitals")
		}
	}

	// Columns.
	byName := map[string]*TableColumn{}
	lower := map[string]bool{}
	cols := make([]TableColumn, len(req.Columns))
	copy(cols, req.Columns)
	if len(cols) == 0 {
		fail(tableStepColumns, "columns", "Add at least one column")
	}
	for i := range cols {
		c := &cols[i]
		field := fmt.Sprintf("columns.%d", i)
		switch {
		case c.Name == "":
			fail(tableStepColumns, field+".name", "Column name is required")
		case len(c.Name) > maxKeyspaceNameLen:
			fail(tableStepColumns, field+".name", fmt.Sprintf("Column name must be at most %d characters", maxKeyspaceNameLen))
		case !keyspaceNameRe.MatchString(c.Name):
			fail(tableStepColumns, field+".name", "Use letters, digits and underscores, starting with a letter")
		case lower[strings.ToLower(c.Name)]:
			fail(tableStepColumns, field+".name", fmt.Sprintf("Duplicate column name %s", c.Name))
		default:
			lower[strings.ToLower(c.Name)] = true
			byName[c.Name] = c
		}
		if msg := checkColumnType(ks, c.Type, true); msg != "" {
			fail(tableStepColumns, field+".type", msg)
		}
	}

	// Keys.
	inKey := map[string]bool{}
	var keyNames []string
	if len(req.PartitionKey) == 0 {
		fail(tableStepKeys, "partition_key", "Choose at least one partition key column")
	}
	addKey := func(field, name string) {
		c := byName[name]
		switch {
		case c == nil:
			fail(tableStepKeys, field, fmt.Sprintf("Key column %s does not exist", name))
			return
		case inKey[name]:
			fail(tableStepKeys, field, fmt.Sprintf("Column %s can be in the key only once", name))
			return
		}
		inKey[name] = true
		keyNames = append(keyNames, name)
		switch {
		case c.Type.Name == "counter" || c.Type.Name == "duration":
			fail(tableStepKeys, field, fmt.Sprintf("Column %s is %s and cannot be part of a key", name, c.Type.Name))
		case c.Static:
			fail(tableStepKeys, field, fmt.Sprintf("Key column %s cannot be static", name))
		default:
			if f, ok := freezeNested(c.Type); ok {
				c.Type = f
				note(fmt.Sprintf("Column %s is frozen because it is part of the primary key", name))
			}
		}
	}
	for i, n := range req.PartitionKey {
		addKey(fmt.Sprintf("partition_key.%d", i), n)
	}
	for i, ck := range req.Clustering {
		field := fmt.Sprintf("clustering.%d", i)
		addKey(field, ck.Column)
		if o := strings.ToUpper(ck.Order); o != "" && o != "ASC" && o != "DESC" {
			fail(tableStepKeys, field+".order", "Order must be ASC or DESC")
		}
	}
	for i, c := range cols {
		if c.Static && !inKey[c.Name] && len(req.Clustering) == 0 {
			fail(tableStepKeys, fmt.Sprintf("columns.%d.static", i), fmt.Sprintf("Static column %s needs at least one clustering column", c.Name))
		}
	}

	// Counters.
	counters, others := 0, 0
	for _, c := range cols {
		if inKey[c.Name] {
			continue
		}
		if c.Type.Name == "counter" {
			counters++
		} else {
			others++
		}
	}
	if counters > 0 {
		if others > 0 {
			fail(tableStepColumns, "columns", "A counter table cannot mix counter and non-counter columns outside the key")
		}
		if req.Options.DefaultTTLSeconds > 0 {
			fail(tableStepOptions, "default_ttl_seconds", tableCounterError)
		}
		note("Counter tables cannot be inserted into, only updated, and cannot use TTLs")
	}

	// Options.
	o := req.Options
	major := 0
	if s != nil {
		major = MajorVersion(s.Version)
	}
	if o.DefaultTTLSeconds < 0 || o.DefaultTTLSeconds > maxDefaultTTL {
		fail(tableStepOptions, "default_ttl_seconds", fmt.Sprintf("Default TTL must be between 0 and %d seconds", maxDefaultTTL))
	}
	if o.GCGraceSeconds != nil && *o.GCGraceSeconds < 0 {
		fail(tableStepOptions, "gc_grace_seconds", "gc_grace_seconds must be at least 0")
	}
	if o.BloomFilterFPChance != nil && (*o.BloomFilterFPChance <= 0 || *o.BloomFilterFPChance > 1) {
		fail(tableStepOptions, "bloom_filter_fp_chance", "Bloom filter false-positive chance must be above 0 and at most 1")
	}
	if len(o.Comment) > maxTableComment {
		fail(tableStepOptions, "comment", fmt.Sprintf("Comment must be at most %d characters", maxTableComment))
	}
	switch o.Compaction.Class {
	case "", CompactionSTCS, CompactionLCS, CompactionTWCS:
	case CompactionUCS:
		if major < 5 {
			fail(tableStepOptions, "compaction", "UnifiedCompactionStrategy needs server 5.0 or later")
		}
	default:
		fail(tableStepOptions, "compaction", fmt.Sprintf("Unknown compaction strategy %s", o.Compaction.Class))
	}
	if c := o.Compression.Class; c != "" && c != CompressionNone {
		if min, ok := compressors[c]; !ok {
			fail(tableStepOptions, "compression", fmt.Sprintf("Unknown compressor %s", c))
		} else if major < min {
			fail(tableStepOptions, "compression", fmt.Sprintf("%s needs server %d.0 or later", c, min))
		}
	}
	if o.Compaction.Class == CompactionTWCS && o.DefaultTTLSeconds == 0 {
		note("Time-window compaction works best with a default TTL")
	}
	if len(req.PartitionKey) == 1 {
		if c := byName[req.PartitionKey[0]]; c != nil && c.Type.Name == "boolean" {
			note("A boolean partition key gives very few partitions")
		}
	}

	if len(p.Errors) > 0 {
		return p
	}
	p.Statement = renderTable(req, cols, inKey)
	return p
}

// nameTaken reports whether a table, view or index of ks already uses name.
func nameTaken(ks *Keyspace, name string) bool {
	for _, t := range ks.Tables {
		if t.Name == name {
			return true
		}
		for _, ix := range t.Indexes {
			if ix.Name == name {
				return true
			}
		}
	}
	for _, v := range ks.Views {
		if v.Name == name {
			return true
		}
	}
	return false
}

// checkColumnType validates a column type; UDTs must live in ks. It returns an error message or "".
func checkColumnType(ks *Keyspace, t codec.TypeDesc, top bool) string {
	switch {
	case t.Name == "":
		return "Choose a type"
	case t.UDT != nil:
		if ks != nil && t.UDT.Keyspace != ks.Name {
			return fmt.Sprintf("Type %s is in keyspace %s; only types of %s can be used", t.UDT.Name, t.UDT.Keyspace, ks.Name)
		}
		if ks != nil && ks.Type(t.UDT.Name) == nil {
			return fmt.Sprintf("Type %s not found in %s", t.UDT.Name, ks.Name)
		}
		return ""
	case t.Name == "counter" && !top:
		return "counter can only be used as a column type"
	case codec.IsNative(t.Name):
		return ""
	}
	want := map[string]int{"list": 1, "set": 1, "map": 2, "vector": 1}
	if n, ok := want[t.Name]; ok {
		if len(t.Args) != n {
			return fmt.Sprintf("%s needs %d type argument(s)", t.Name, n)
		}
		if t.Name == "vector" && t.Size < 1 {
			return "vector needs a dimension of at least 1"
		}
	} else if t.Name == "tuple" {
		if len(t.Args) == 0 {
			return "tuple needs at least one type"
		}
	} else {
		return fmt.Sprintf("Unknown type %s", t.Name)
	}
	for _, a := range t.Args {
		if msg := checkColumnType(ks, a, false); msg != "" {
			return msg
		}
	}
	return ""
}

func renderTable(req TableRequest, cols []TableColumn, inKey map[string]bool) string {
	var b strings.Builder
	b.WriteString("CREATE TABLE ")
	if req.IfNotExists {
		b.WriteString("IF NOT EXISTS ")
	}
	b.WriteString(Ident(req.Keyspace) + "." + Ident(req.Name) + " (\n")
	for _, c := range cols {
		b.WriteString("  " + Ident(c.Name) + " " + c.Type.String())
		if c.Static {
			b.WriteString(" STATIC")
		}
		b.WriteString(",\n")
	}
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
	b.WriteString("  PRIMARY KEY (" + strings.Join(key, ", ") + ")\n)")

	var with []string
	if desc {
		with = append(with, "CLUSTERING ORDER BY ("+strings.Join(order, ", ")+")")
	}
	o := req.Options
	if o.Comment != "" {
		with = append(with, "comment = "+quote(o.Comment))
	}
	if o.DefaultTTLSeconds != 0 {
		with = append(with, fmt.Sprintf("default_time_to_live = %d", o.DefaultTTLSeconds))
	}
	if o.GCGraceSeconds != nil && *o.GCGraceSeconds != defaultGCGrace {
		with = append(with, fmt.Sprintf("gc_grace_seconds = %d", *o.GCGraceSeconds))
	}
	if o.BloomFilterFPChance != nil && *o.BloomFilterFPChance != defaultBloomFP {
		with = append(with, "bloom_filter_fp_chance = "+literalFloat(*o.BloomFilterFPChance, 64))
	}
	if (o.Compaction.Class != "" && o.Compaction.Class != CompactionSTCS) || len(o.Compaction.Params) > 0 {
		m := map[string]string{"class": o.Compaction.Class}
		if o.Compaction.Class == "" {
			m["class"] = CompactionSTCS
		}
		for k, v := range o.Compaction.Params {
			m[k] = v
		}
		with = append(with, "compaction = "+literalMap(m))
	}
	switch c := o.Compression.Class; c {
	case "", CompressionLZ4:
	case CompressionNone:
		with = append(with, "compression = {'enabled': false}")
	default:
		with = append(with, "compression = "+literalMap(map[string]string{"class": c}))
	}
	if len(with) > 0 {
		b.WriteString(" WITH " + strings.Join(with, " AND "))
	}
	b.WriteString(";")
	return b.String()
}
