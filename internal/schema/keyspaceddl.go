package schema

import (
	"fmt"
	"regexp"
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
