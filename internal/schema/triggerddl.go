package schema

import (
	"fmt"
	"regexp"
	"strings"
)

// Trigger actions accepted by PlanTrigger (SPEC §9.22).
const (
	TriggerCreate = "create"
	TriggerDrop   = "drop"
)

// triggerClassRe is a dotted Java class name.
var triggerClassRe = regexp.MustCompile(`^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$`)

// TriggerNote is attached to every create plan.
const TriggerNote = "The class must be in a JAR in every node's triggers directory; Helenus cannot check this"

// TriggerRequest describes a trigger to create (Name, Class) or drop (Name) on Table.
type TriggerRequest struct {
	Action      string `json:"action"`
	Keyspace    string `json:"keyspace"`
	Table       string `json:"table"`
	Name        string `json:"name"`
	Class       string `json:"class"`
	IfNotExists bool   `json:"if_not_exists"`
	IfExists    bool   `json:"if_exists"`
}

// TriggerPlan is the result of planning a trigger change.
type TriggerPlan = KeyspacePlan

// PlanTrigger validates req against the snapshot and renders CREATE TRIGGER or DROP TRIGGER.
func PlanTrigger(s *Snapshot, req TriggerRequest) TriggerPlan {
	p := TriggerPlan{Errors: []PlanError{}, Notes: []string{}}
	fail := func(field, msg string) { p.Errors = append(p.Errors, PlanError{Field: field, Message: msg}) }

	var ks *Keyspace
	if s != nil {
		ks = s.Keyspace(req.Keyspace)
	}
	if ks == nil {
		fail("keyspace", fmt.Sprintf("Keyspace %s not found", req.Keyspace))
		return p
	}
	if ks.System {
		fail("keyspace", fmt.Sprintf("%s is a system keyspace; its triggers cannot be changed", ks.Name))
		return p
	}
	t := ks.Table(req.Table)
	if t == nil {
		fail("table", fmt.Sprintf("Table %s not found", req.Table))
		return p
	}
	exists := false
	for _, tr := range t.Triggers {
		exists = exists || tr.Name == req.Name
	}

	if req.Action == TriggerDrop {
		switch {
		case req.Name == "":
			fail("name", "Trigger name is required")
		case !exists && !req.IfExists:
			fail("name", fmt.Sprintf("Trigger %s not found on %s", req.Name, t.Name))
		}
		if len(p.Errors) == 0 {
			stmt := "DROP TRIGGER "
			if req.IfExists {
				stmt += "IF EXISTS "
			}
			p.Statement = stmt + Ident(req.Name) + " ON " + qname(ks.Name, t.Name) + ";"
		}
		return p
	}

	switch {
	case req.Name == "":
		fail("name", "Trigger name is required")
	case len(req.Name) > maxKeyspaceNameLen:
		fail("name", fmt.Sprintf("At most %d characters", maxKeyspaceNameLen))
	case !keyspaceNameRe.MatchString(req.Name):
		fail("name", "Use letters, digits and underscores, starting with a letter")
	case exists && req.IfNotExists:
		p.Notes = append(p.Notes, fmt.Sprintf("Trigger %s already exists; IF NOT EXISTS makes this a no-op", req.Name))
	case exists:
		fail("name", fmt.Sprintf("Trigger %s already exists on %s", req.Name, t.Name))
	}
	switch {
	case req.Class == "":
		fail("class", "Class name is required")
	case !triggerClassRe.MatchString(req.Class):
		fail("class", "Use a fully qualified Java class name such as com.example.Audit")
	}
	p.Notes = append(p.Notes, TriggerNote)
	if len(p.Errors) == 0 {
		stmt := "CREATE TRIGGER "
		if req.IfNotExists {
			stmt += "IF NOT EXISTS "
		}
		p.Statement = stmt + Ident(req.Name) + " ON " + qname(ks.Name, t.Name) + " USING '" + strings.ReplaceAll(req.Class, "'", "''") + "';"
	}
	return p
}
