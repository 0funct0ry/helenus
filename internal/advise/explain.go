// Package advise turns planned DDL into plain-language explanations and checks table
// definitions against common data-modeling mistakes (SPEC §9.25). Everything here is a
// deterministic text template: no LLM and no network calls.
package advise

import (
	"fmt"
	"strings"

	"github.com/0funct0ry/helenus/internal/schema"
)

const irreversible = "This cannot be undone."

func lines(l ...string) []string { return l }

func nonEmpty(l []string) []string {
	if len(l) == 0 {
		return []string{"No changes."}
	}
	return l
}

func deletes(kind, name string) string {
	return fmt.Sprintf("Deletes %s %s and all of its data. %s", kind, name, irreversible)
}

func joinAnd(items []string) string {
	switch len(items) {
	case 0:
		return ""
	case 1:
		return items[0]
	}
	return strings.Join(items[:len(items)-1], ", ") + " and " + items[len(items)-1]
}

func isTimeType(t string) bool {
	switch t {
	case "timestamp", "timeuuid", "date", "time":
		return true
	}
	return false
}

// ExplainKeyspace explains a keyspace create, alter or drop.
func ExplainKeyspace(req schema.KeyspaceRequest) []string {
	name := req.Name
	switch req.Action {
	case "drop":
		return lines(deletes("keyspace", name))
	case "alter":
		out := lines(fmt.Sprintf("Changes the replication settings of keyspace %s.", name))
		out = append(out, replicationLines(req)...)
		return append(out, "Existing data is not copied automatically; run a repair so new replicas receive it.")
	}
	out := lines(fmt.Sprintf("Creates keyspace %s.", name))
	out = append(out, replicationLines(req)...)
	if !req.DurableWrites {
		out = append(out, "Writes skip the commit log, so a node crash can lose recent data.")
	}
	return out
}

func replicationLines(req schema.KeyspaceRequest) []string {
	if req.Strategy == schema.StrategyNTS {
		var out []string
		for _, dc := range req.Datacenters {
			out = append(out, fmt.Sprintf("Keeps %d %s of every row in datacenter %s.", dc.RF, copies(dc.RF), dc.Name))
		}
		return out
	}
	return lines(fmt.Sprintf("Keeps %d %s of every row, placed without regard to datacenter.", req.ReplicationFactor, copies(req.ReplicationFactor)))
}

func copies(n int) string {
	if n == 1 {
		return "copy"
	}
	return "copies"
}

// ExplainTable explains a table create, alter, truncate or drop.
func ExplainTable(s *schema.Snapshot, req schema.TableRequest) []string {
	t := req.Name
	switch req.Action {
	case schema.TableAddColumn:
		return lines(fmt.Sprintf("Adds column %s (%s) to table %s.", req.Column.Name, req.Column.Type.String(), t), "Existing rows read the new column as empty.")
	case schema.TableDropColumn:
		return lines(fmt.Sprintf("Removes column %s from table %s along with its data. %s", req.Column.Name, t, irreversible))
	case schema.TableRenameColumn:
		return lines(fmt.Sprintf("Renames column %s to %s in table %s.", req.From, req.To, t), "Only primary key columns can be renamed.")
	case schema.TableOptionsAlter:
		return lines(fmt.Sprintf("Changes the settings of table %s.", t), "Existing data is not rewritten right away; compaction applies some settings over time.")
	case schema.TableTruncate:
		return lines(fmt.Sprintf("Deletes every row in table %s. %s", t, irreversible))
	case schema.TableDrop:
		return lines(deletes("table", t))
	case schema.ViewOptionsAlter, schema.ViewDrop:
		return ExplainView(schema.ViewRequest{Action: map[string]string{schema.ViewDrop: "drop", schema.ViewOptionsAlter: "alter"}[req.Action], Name: t})
	case "", "create":
	default:
		return nonEmpty(nil)
	}
	types := map[string]string{}
	for _, c := range req.Columns {
		types[c.Name] = c.Type.Name
	}
	out := lines(fmt.Sprintf("Creates table %s in keyspace %s.", t, req.Keyspace))
	if len(req.PartitionKey) > 0 {
		pk := joinAnd(req.PartitionKey)
		if len(req.PartitionKey) == 1 {
			out = append(out, fmt.Sprintf("Rows are spread across the cluster by %s: each %s value lives on its own set of replicas.", pk, req.PartitionKey[0]))
		} else {
			out = append(out, fmt.Sprintf("Rows are spread across the cluster by %s: each combination of those values lives on its own set of replicas.", pk))
		}
	}
	var sorted []string
	var names []string
	for _, c := range req.Clustering {
		desc := strings.EqualFold(c.Order, "DESC")
		var dir string
		switch {
		case isTimeType(types[c.Column]) && desc:
			dir = "newest first"
		case isTimeType(types[c.Column]):
			dir = "oldest first"
		case desc:
			dir = "largest first"
		default:
			dir = "smallest first"
		}
		sorted = append(sorted, fmt.Sprintf("%s, %s", c.Column, dir))
		names = append(names, c.Column)
	}
	if len(sorted) > 0 {
		out = append(out, fmt.Sprintf("Inside each partition, rows are sorted by %s.", strings.Join(sorted, ", then by ")))
	}
	if len(req.PartitionKey) > 0 {
		q := fmt.Sprintf("Queries must include %s", joinAnd(req.PartitionKey))
		if len(names) > 0 {
			q += fmt.Sprintf("; they can also filter or range over %s", joinAnd(names))
		}
		out = append(out, q+".")
	}
	return out
}

// ExplainView explains a materialized view create, alter or drop.
func ExplainView(req schema.ViewRequest) []string {
	switch req.Action {
	case schema.ViewDropAction:
		return lines(deletes("materialized view", req.Name))
	case schema.ViewAlter:
		return lines(fmt.Sprintf("Changes the settings of materialized view %s.", req.Name))
	}
	return lines(
		fmt.Sprintf("Creates materialized view %s from table %s.", req.Name, req.BaseTable),
		fmt.Sprintf("Cassandra copies every write to %s into the view, stored with its own partition key.", req.BaseTable),
		"Extra writes make the base table slower; views are still experimental.",
	)
}

// ExplainIndex explains an index create or drop.
func ExplainIndex(s *schema.Snapshot, req schema.IndexRequest) []string {
	if req.Action == schema.IndexDrop {
		name := req.Name
		return lines(fmt.Sprintf("Removes index %s. Queries that relied on it stop working.", name))
	}
	pk := "the partition key"
	if s != nil {
		if ks := s.Keyspace(req.Keyspace); ks != nil {
			if t := ks.Table(req.Table); t != nil {
				var cols []string
				for _, c := range t.Columns {
					if c.Kind == schema.KindPartition {
						cols = append(cols, c.Name)
					}
				}
				if len(cols) > 0 {
					pk = joinAnd(cols)
				}
			}
		}
	}
	if req.Kind == schema.IndexKindSAI {
		return lines(fmt.Sprintf("Lets you filter table %s by %s without including %s.", req.Table, req.Column, pk), "The index is stored next to the data on each node and updated on every write.")
	}
	return lines(fmt.Sprintf("Lets you query %s by %s without including %s; each such query asks every node.", req.Table, req.Column, pk))
}

// ExplainType explains a user-defined type change.
func ExplainType(req schema.TypeRequest) []string {
	switch req.Action {
	case schema.TypeAddField:
		if req.Field != nil {
			return lines(fmt.Sprintf("Adds field %s to type %s. Existing values read it as empty.", req.Field.Name, req.Name))
		}
	case schema.TypeRenameField:
		return lines(fmt.Sprintf("Renames field %s to %s in type %s.", req.From, req.To, req.Name))
	case schema.TypeDrop:
		return lines(fmt.Sprintf("Removes type %s. It can only be dropped when no table or type uses it.", req.Name))
	case schema.TypeCreate:
		var f []string
		for _, x := range req.Fields {
			f = append(f, x.Name)
		}
		return lines(fmt.Sprintf("Creates type %s with fields %s.", req.Name, joinAnd(f)), "Use it as a column type, usually frozen.")
	}
	return nonEmpty(nil)
}

// ExplainFunction explains a user-defined function change.
func ExplainFunction(req schema.FunctionRequest) []string {
	switch req.Action {
	case schema.FunctionDrop:
		return lines(fmt.Sprintf("Removes function %s. Aggregates and queries that call it stop working.", req.Name))
	case schema.FunctionReplace:
		return lines(fmt.Sprintf("Replaces the body of function %s.", req.Name), "Callers use the new code immediately.")
	}
	return lines(fmt.Sprintf("Creates function %s that runs %s code inside Cassandra.", req.Name, req.Language), "It can be called from SELECT and used by aggregates.")
}

// ExplainAggregate explains a user-defined aggregate change.
func ExplainAggregate(req schema.AggregateRequest) []string {
	switch req.Action {
	case schema.AggregateDrop:
		return lines(fmt.Sprintf("Removes aggregate %s.", req.Name))
	case schema.AggregateReplace:
		return lines(fmt.Sprintf("Replaces aggregate %s.", req.Name))
	}
	return lines(fmt.Sprintf("Creates aggregate %s that folds rows with %s into a %s value.", req.Name, req.SFunc, req.SType))
}

// ExplainTrigger explains a trigger change.
func ExplainTrigger(req schema.TriggerRequest) []string {
	if req.Action == schema.TriggerDrop {
		return lines(fmt.Sprintf("Removes trigger %s from table %s.", req.Name, req.Table))
	}
	return lines(fmt.Sprintf("Runs %s on every write to table %s.", req.Class, req.Table))
}

// ExplainRole explains a role statement without ever mentioning a password.
func ExplainRole(req schema.RoleRequest) []string {
	switch req.Action {
	case schema.RoleCreate:
		return lines(fmt.Sprintf("Creates role %s.", req.Role), "A role can sign in only when LOGIN is true.")
	case schema.RoleAlter:
		return lines(fmt.Sprintf("Changes the settings of role %s.", req.Role))
	case schema.RoleDrop:
		return lines(fmt.Sprintf("Removes role %s and every permission granted to it.", req.Role))
	case schema.RoleGrantRole:
		return lines(fmt.Sprintf("Gives %s every permission that %s has.", req.Role, req.MemberOf))
	case schema.RoleRevokeRole:
		return lines(fmt.Sprintf("Takes the permissions of %s away from %s.", req.MemberOf, req.Role))
	case schema.RoleGrant:
		return lines(fmt.Sprintf("Allows %s to use %s on %s.", req.Role, req.Permission, resourceText(req.Resource)))
	case schema.RoleRevoke:
		return lines(fmt.Sprintf("Stops %s from using %s on %s.", req.Role, req.Permission, resourceText(req.Resource)))
	}
	return nonEmpty(nil)
}

func resourceText(r *schema.Resource) string {
	if r == nil {
		return "the chosen resource"
	}
	switch r.Kind {
	case schema.ResAllKeyspaces:
		return "all keyspaces"
	case schema.ResKeyspace:
		return "keyspace " + r.Keyspace
	case schema.ResTable:
		return "table " + r.Keyspace + "." + r.Name
	case schema.ResAllRoles:
		return "all roles"
	case schema.ResRole:
		return "role " + r.Name
	case schema.ResAllFunctions:
		return "all functions"
	case schema.ResFunctionsInKS:
		return "all functions in keyspace " + r.Keyspace
	case schema.ResFunction:
		return "function " + r.Keyspace + "." + r.Name
	}
	return "the chosen resource"
}
