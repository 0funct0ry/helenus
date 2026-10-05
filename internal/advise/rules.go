package advise

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/0funct0ry/helenus/internal/schema"
)

// Severities of a Finding. Findings never block an action.
const (
	SeverityInfo    = "info"
	SeverityWarning = "warning"
)

// helpBase is the docs page that holds one anchor per rule id.
const helpBase = "/docs/data-modeling-tips-in-helenus#"

// Finding is one piece of data-modeling advice.
type Finding struct {
	ID       string `json:"id"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
	HelpURL  string `json:"help_url"`
	// Keyspace and Table say what the finding is about; Table is empty for keyspace-level findings.
	Keyspace string `json:"keyspace"`
	Table    string `json:"table,omitempty"`
}

// Note renders the finding as a preview note, prefixed with its id.
func (f Finding) Note() string { return f.ID + ": " + f.Message }

// ClusterFacts is what the rules need to know about the cluster; zero means unknown.
type ClusterFacts struct {
	Nodes int
	DCs   int
}

var timeBucketName = regexp.MustCompile(`(?i)bucket|day|month|hour`)

func newFinding(id, sev, ks, table, msg string) Finding {
	return Finding{ID: id, Severity: sev, Message: msg, HelpURL: helpBase + strings.ToLower(id), Keyspace: ks, Table: table}
}

// AdviseTable applies the table-level rules (A001–A007, A010) to t.
func AdviseTable(t schema.Table, facts ClusterFacts) []Finding {
	var out []Finding
	add := func(id, sev, msg string) { out = append(out, newFinding(id, sev, t.Keyspace, t.Name, msg)) }

	var pk, clustering []schema.Column
	for _, c := range t.Columns {
		switch c.Kind {
		case schema.KindPartition:
			pk = append(pk, c)
		case schema.KindClustering:
			clustering = append(clustering, c)
		}
	}

	// A001
	if len(pk) == 1 {
		switch pk[0].Type.Name {
		case "boolean", "tinyint", "date":
			add("A001", SeverityWarning, "Very few partitions; load will concentrate on a few nodes")
		}
	}

	// A002
	timeClustering := false
	for _, c := range clustering {
		switch c.Type.Name {
		case "timestamp", "timeuuid", "date":
			timeClustering = true
		}
	}
	if timeClustering {
		bucketed := false
		for _, c := range pk {
			if (c.Type.Name == "date" || c.Type.Name == "int") && timeBucketName.MatchString(c.Name) {
				bucketed = true
			}
		}
		if !bucketed {
			add("A002", SeverityWarning, "Partitions grow without bound; add a time bucket to the partition key")
		}
	}

	// A003
	if len(t.Indexes) > 3 {
		add("A003", SeverityWarning, fmt.Sprintf("Many indexes slow writes: this table has %d", len(t.Indexes)))
	}

	// A004
	types := map[string]string{}
	for _, c := range t.Columns {
		types[c.Name] = c.Type.Name
	}
	var risky []string
	for _, ix := range t.Indexes {
		if ix.SAI || ix.Column == "" {
			continue
		}
		lower := strings.ToLower(ix.Column)
		switch ty := types[ix.Column]; {
		case ty == "uuid", ty == "timeuuid", ty == "timestamp",
			ty == "text" && (strings.HasSuffix(lower, "id") || lower == "email"):
			risky = append(risky, ix.Column)
		}
	}
	if len(risky) > 0 {
		sort.Strings(risky)
		add("A004", SeverityWarning, fmt.Sprintf("Index on high-cardinality column %s: lookups touch many nodes; consider a separate lookup table", joinAnd(risky)))
	}

	// A005, A006, A007
	collections, counters, hasList := 0, 0, false
	for _, c := range t.Columns {
		switch c.Type.Name {
		case "list", "set", "map":
			if !c.Type.Frozen {
				collections++
				if c.Type.Name == "list" {
					hasList = true
				}
			}
		case "counter":
			counters++
		}
	}
	if collections > 5 {
		add("A005", SeverityInfo, fmt.Sprintf("%d non-frozen collection columns; each is read and written as a whole cell group, so keep few", collections))
	}
	if len(clustering) == 0 && hasList {
		add("A006", SeverityInfo, "Lists rewrite on prepend/remove-by-value; consider a set or clustering")
	}
	if counters > 10 {
		add("A007", SeverityInfo, fmt.Sprintf("%d counter columns in one table; counter updates are slow, so split the table", counters))
	}

	// A010
	if optionValue(t.Options, "default_time_to_live") == "0" || optionValue(t.Options, "default_time_to_live") == "" {
		if strings.Contains(optionValue(t.Options, "compaction"), "TimeWindowCompactionStrategy") {
			add("A010", SeverityWarning, "Time-window compaction works best when data expires; set a default TTL")
		}
	}
	return out
}

func optionValue(opts []schema.Option, name string) string {
	for _, o := range opts {
		if o.Name == name {
			v := strings.TrimSpace(o.Value)
			if n, err := strconv.Atoi(v); err == nil {
				return strconv.Itoa(n)
			}
			return v
		}
	}
	return ""
}

// AdviseKeyspace applies the keyspace-level rules (A008, A009).
func AdviseKeyspace(ks schema.Keyspace, facts ClusterFacts) []Finding {
	if ks.System || len(ks.Replication) == 0 {
		return nil
	}
	class, rfs := schema.CurrentReplication(ks.Replication)
	var out []Finding
	if class == schema.StrategySimple && facts.DCs > 1 {
		out = append(out, newFinding("A008", SeverityWarning, ks.Name, "", "SimpleStrategy ignores datacenters; use NetworkTopologyStrategy on a multi-datacenter cluster"))
	}
	if facts.Nodes > 1 {
		for _, rf := range rfs {
			if rf == 1 {
				out = append(out, newFinding("A009", SeverityWarning, ks.Name, "", "A single node failure makes data unavailable"))
				break
			}
		}
	}
	return out
}

// AdviseKeyspaceAll lists findings for a keyspace and each of its tables.
func AdviseKeyspaceAll(ks schema.Keyspace, facts ClusterFacts) []Finding {
	if ks.System {
		return []Finding{}
	}
	out := append([]Finding{}, AdviseKeyspace(ks, facts)...)
	for _, t := range ks.Tables {
		out = append(out, AdviseTable(t, facts)...)
	}
	return out
}

// DraftTable builds the table a create request would produce, for advising before it exists.
func DraftTable(req schema.TableRequest) schema.Table {
	t := schema.Table{Keyspace: req.Keyspace, Name: req.Name}
	kinds := map[string]string{}
	pos := map[string]int{}
	order := map[string]string{}
	for i, n := range req.PartitionKey {
		kinds[n], pos[n] = schema.KindPartition, i+1
	}
	for i, c := range req.Clustering {
		kinds[c.Column], pos[c.Column], order[c.Column] = schema.KindClustering, i+1, c.Order
	}
	for _, c := range req.Columns {
		kind := kinds[c.Name]
		switch {
		case kind != "":
		case c.Static:
			kind = schema.KindStatic
		default:
			kind = schema.KindRegular
		}
		t.Columns = append(t.Columns, schema.Column{Name: c.Name, Type: c.Type, CQL: c.Type.String(), Kind: kind, Position: pos[c.Name], Order: order[c.Name]})
		if c.Type.Name == "counter" {
			t.Counter = true
		}
	}
	if ttl := req.Options.DefaultTTLSeconds; ttl > 0 {
		t.Options = append(t.Options, schema.Option{Name: "default_time_to_live", Value: strconv.Itoa(ttl)})
	}
	if req.Options.Compaction.Class != "" {
		t.Options = append(t.Options, schema.Option{Name: "compaction", Value: "{'class': '" + req.Options.Compaction.Class + "'}"})
	}
	return t
}

// DraftKeyspace builds the keyspace a create or alter request would produce.
func DraftKeyspace(req schema.KeyspaceRequest) schema.Keyspace {
	rep := map[string]string{"class": req.Strategy}
	if req.Strategy == schema.StrategyNTS {
		for _, dc := range req.Datacenters {
			rep[dc.Name] = strconv.Itoa(dc.RF)
		}
	} else {
		rep["replication_factor"] = strconv.Itoa(req.ReplicationFactor)
	}
	return schema.Keyspace{Name: req.Name, Replication: rep}
}

// AdviseIndex lists the index rules (A003, A004) that would hold once the requested index exists.
func AdviseIndex(s *schema.Snapshot, req schema.IndexRequest, facts ClusterFacts) []Finding {
	if s == nil || req.Action == schema.IndexDrop {
		return nil
	}
	ks := s.Keyspace(req.Keyspace)
	if ks == nil || ks.System {
		return nil
	}
	t := ks.Table(req.Table)
	if t == nil {
		return nil
	}
	draft := *t
	draft.Indexes = append(append([]schema.Index{}, t.Indexes...), schema.Index{Name: req.Name, Column: req.Column, SAI: req.Kind == schema.IndexKindSAI})
	var out []Finding
	for _, f := range AdviseTable(draft, facts) {
		if f.ID == "A003" || f.ID == "A004" {
			out = append(out, f)
		}
	}
	return out
}

// Notes renders findings as preview notes.
func Notes(fs []Finding) []string {
	out := make([]string, 0, len(fs))
	for _, f := range fs {
		out = append(out, f.Note())
	}
	return out
}
