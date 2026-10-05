package schema

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Replication strategies a new keyspace can use (SPEC §9.3).
const (
	StrategySimple = "SimpleStrategy"
	StrategyNTS    = "NetworkTopologyStrategy"
)

const (
	maxKeyspaceNameLen = 48
	minRF, maxRF       = 1, 20
)

var keyspaceNameRe = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]*$`)

// DCRequest is one datacenter row of a NetworkTopologyStrategy keyspace.
type DCRequest struct {
	Name string `json:"name"`
	RF   int    `json:"rf"`
}

// KeyspaceRequest describes a keyspace to create.
type KeyspaceRequest struct {
	Name              string      `json:"name"`
	Strategy          string      `json:"strategy"`
	ReplicationFactor int         `json:"replication_factor"`
	Datacenters       []DCRequest `json:"datacenters"`
	DurableWrites     bool        `json:"durable_writes"`
	IfNotExists       bool        `json:"if_not_exists"`
	// Action is "create" (default), "alter" or "drop". Alter and drop target the existing keyspace Name.
	Action string `json:"action,omitempty"`
}

// PlanError is a validation problem tied to a form field (for example "name" or "datacenters.1.rf").
type PlanError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// KeyspacePlan is the result of planning a keyspace creation: the statement (empty when there are
// errors), the blocking errors, and non-blocking notes.
type KeyspacePlan struct {
	Statement string      `json:"statement"`
	Errors    []PlanError `json:"errors"`
	Notes     []string    `json:"notes"`
}

// PlanKeyspace validates req against the snapshot and renders CREATE KEYSPACE. dcNodes maps each
// datacenter to its node count and may be nil; it only drives the replication notes.
func PlanKeyspace(s *Snapshot, req KeyspaceRequest, dcNodes map[string]int) KeyspacePlan {
	p := KeyspacePlan{Errors: []PlanError{}, Notes: []string{}}
	switch req.Action {
	case "alter":
		return planAlterKeyspace(s, req, dcNodes, p)
	case "drop":
		return planDropKeyspace(s, req, p)
	}
	fail := func(field, msg string) { p.Errors = append(p.Errors, PlanError{Field: field, Message: msg}) }
	note := func(msg string) { p.Notes = append(p.Notes, msg) }

	name := req.Name
	switch {
	case name == "":
		fail("name", "Name is required")
	case len(name) > maxKeyspaceNameLen:
		fail("name", fmt.Sprintf("Name must be at most %d characters", maxKeyspaceNameLen))
	case !keyspaceNameRe.MatchString(name):
		fail("name", "Use letters, digits and underscores, starting with a letter")
	case strings.HasPrefix(strings.ToLower(name), "system"):
		fail("name", "Names starting with system are reserved")
	default:
		if s != nil && s.Keyspace(name) != nil {
			if req.IfNotExists {
				note("A keyspace with this name exists; nothing will change")
			} else {
				fail("name", "A keyspace with this name already exists")
			}
		}
		if name != strings.ToLower(name) {
			note("Case is preserved because the name contains capitals")
		}
	}

	repl := replicationClause(req, dcNodes, fail, note)
	if !req.DurableWrites {
		note("Commit log is skipped; data may be lost on a crash")
	}

	if len(p.Errors) > 0 {
		return p
	}
	ine := ""
	if req.IfNotExists {
		ine = "IF NOT EXISTS "
	}
	p.Statement = fmt.Sprintf("CREATE KEYSPACE %s%s WITH replication = %s AND durable_writes = %t;",
		ine, Ident(name), repl, req.DurableWrites)
	return p
}

// replicationClause validates the strategy fields of req and renders the replication map. It returns ""
// when strategy is invalid; problems go through fail and note.
func replicationClause(req KeyspaceRequest, dcNodes map[string]int, fail func(field, msg string), note func(msg string)) string {
	var repl string
	switch req.Strategy {
	case StrategySimple:
		if req.ReplicationFactor < minRF || req.ReplicationFactor > maxRF {
			fail("replication_factor", fmt.Sprintf("Replication factor must be between %d and %d", minRF, maxRF))
		}
		repl = "{'class': 'SimpleStrategy', 'replication_factor': " + strconv.Itoa(req.ReplicationFactor) + "}"
		if len(dcNodes) > 1 {
			note("This cluster has several datacenters; use NetworkTopologyStrategy in production")
		}
		total := 0
		for _, n := range dcNodes {
			total += n
		}
		if total > 0 && req.ReplicationFactor > total {
			note(fmt.Sprintf("Replication factor %d is greater than the %d nodes in the cluster", req.ReplicationFactor, total))
		}
	case StrategyNTS:
		if len(req.Datacenters) == 0 {
			fail("datacenters", "Add at least one datacenter")
		}
		seen := map[string]bool{}
		parts := []string{"'class': 'NetworkTopologyStrategy'"}
		for i, dc := range req.Datacenters {
			nf := fmt.Sprintf("datacenters.%d.name", i)
			rf := fmt.Sprintf("datacenters.%d.rf", i)
			switch {
			case strings.TrimSpace(dc.Name) == "":
				fail(nf, "Datacenter name is required")
			case strings.ContainsAny(dc.Name, `'"`):
				fail(nf, "Datacenter name cannot contain quotes")
			case seen[dc.Name]:
				fail(nf, "Datacenter names must be unique")
			}
			seen[dc.Name] = true
			if dc.RF < minRF || dc.RF > maxRF {
				fail(rf, fmt.Sprintf("Replication factor must be between %d and %d", minRF, maxRF))
			} else if n, ok := dcNodes[dc.Name]; ok && dc.RF > n {
				note(fmt.Sprintf("RF %d is greater than the %d nodes in %s", dc.RF, n, dc.Name))
			}
			parts = append(parts, quote(dc.Name)+": "+strconv.Itoa(dc.RF))
		}
		repl = "{" + strings.Join(parts, ", ") + "}"
	default:
		fail("strategy", "Choose SimpleStrategy or NetworkTopologyStrategy")
	}
	return repl
}

// existingUserKeyspace checks that req.Name names an existing, non-system keyspace.
func existingUserKeyspace(s *Snapshot, name string, p *KeyspacePlan) *Keyspace {
	var ks *Keyspace
	if s != nil {
		ks = s.Keyspace(name)
	}
	switch {
	case ks == nil:
		p.Errors = append(p.Errors, PlanError{Field: "name", Message: "Keyspace " + name + " does not exist"})
	case ks.System || strings.HasPrefix(strings.ToLower(name), "system"):
		p.Errors = append(p.Errors, PlanError{Field: "name", Message: "System keyspaces cannot be changed"})
	default:
		return ks
	}
	return nil
}

func planDropKeyspace(s *Snapshot, req KeyspaceRequest, p KeyspacePlan) KeyspacePlan {
	if existingUserKeyspace(s, req.Name, &p) != nil {
		p.Statement = "DROP KEYSPACE " + Ident(req.Name) + ";"
	}
	return p
}

// currentReplication reads a snapshot replication map into a strategy and per-datacenter factors. For
// SimpleStrategy the single factor is stored under the key "".
func currentReplication(m map[string]string) (string, map[string]int) {
	class := m["class"]
	class = class[strings.LastIndex(class, ".")+1:]
	rfs := map[string]int{}
	for k, v := range m {
		if k == "class" {
			continue
		}
		n, _ := strconv.Atoi(v)
		if k == "replication_factor" {
			k = ""
		}
		rfs[k] = n
	}
	return class, rfs
}

func planAlterKeyspace(s *Snapshot, req KeyspaceRequest, dcNodes map[string]int, p KeyspacePlan) KeyspacePlan {
	fail := func(field, msg string) { p.Errors = append(p.Errors, PlanError{Field: field, Message: msg}) }
	note := func(msg string) { p.Notes = append(p.Notes, msg) }
	ks := existingUserKeyspace(s, req.Name, &p)
	if ks == nil {
		return p
	}
	if req.Strategy == StrategyNTS && len(dcNodes) > 0 {
		for i, dc := range req.Datacenters {
			if _, ok := dcNodes[dc.Name]; !ok && strings.TrimSpace(dc.Name) != "" {
				fail(fmt.Sprintf("datacenters.%d.name", i), "Unknown datacenter "+dc.Name)
			}
		}
	}
	repl := replicationClause(req, dcNodes, fail, note)
	if !req.DurableWrites {
		note("Commit log is skipped; data may be lost on a crash")
	}
	if len(p.Errors) > 0 {
		return p
	}

	oldClass, oldRF := currentReplication(ks.Replication)
	newRF := map[string]int{}
	if req.Strategy == StrategySimple {
		newRF[""] = req.ReplicationFactor
	} else {
		for _, dc := range req.Datacenters {
			newRF[dc.Name] = dc.RF
		}
	}
	replChanged := oldClass != req.Strategy || len(oldRF) != len(newRF)
	for k, v := range newRF {
		if o, ok := oldRF[k]; !ok || o != v {
			replChanged = true
		}
	}
	durableChanged := ks.DurableWrites != req.DurableWrites

	var clauses []string
	if replChanged {
		clauses = append(clauses, "replication = "+repl)
		keys := make([]string, 0, len(newRF))
		for k := range newRF {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		decrease := false
		for _, k := range keys {
			label := k
			if k == "" {
				label = "the cluster"
			}
			if newRF[k] > oldRF[k] {
				note(fmt.Sprintf("Run `nodetool repair -full` on every node in %s so existing data reaches the new replicas", label))
			}
			if newRF[k] < oldRF[k] {
				decrease = true
			}
		}
		for k, v := range oldRF {
			if _, ok := newRF[k]; !ok && v > 0 {
				decrease = true
			}
		}
		if decrease {
			note("Run `nodetool cleanup` on every node")
		}
		if oldClass == StrategySimple && req.Strategy == StrategyNTS {
			for _, dc := range req.Datacenters {
				note(fmt.Sprintf("Keep the datacenter name exactly as reported (`%s`) or data becomes unreachable", dc.Name))
			}
		}
	}
	if durableChanged {
		clauses = append(clauses, "durable_writes = "+strconv.FormatBool(req.DurableWrites))
	}
	if len(clauses) == 0 {
		fail("", "Nothing to change")
		p.Notes = []string{}
		return p
	}
	p.Statement = "ALTER KEYSPACE " + Ident(req.Name) + " WITH " + strings.Join(clauses, " AND ") + ";"
	return p
}
