// Package mutate turns grid edits into CQL. A Change describes one edit in the
// grid's own JSON encoding (SPEC §7.3); Compile checks it against the schema and
// produces a prepared statement with bound values plus a literal-rendered
// preview; Apply runs the statements one at a time (SPEC §9.9).
package mutate

import (
	"encoding/json"
	"errors"
	"fmt"
)

// Kind is the type of one change.
type Kind string

// The change kinds, one per row of the SPEC §9.9 table plus whole-value replace.
const (
	SetCell         Kind = "set_cell"          // UPDATE … SET col = ?
	SetNull         Kind = "set_null"          // DELETE col FROM …
	InsertRow       Kind = "insert_row"        // INSERT INTO … [IF NOT EXISTS]
	DeleteRow       Kind = "delete_row"        // DELETE FROM …
	CounterDelta    Kind = "counter_delta"     // SET c = c + ?
	ListAppend      Kind = "list_append"       // SET l = l + ?
	ListPrepend     Kind = "list_prepend"      // SET l = ? + l
	ListSetIndex    Kind = "list_set_index"    // SET l[i] = ?
	ListRemoveIndex Kind = "list_remove_index" // DELETE l[i] FROM …
	SetAdd          Kind = "set_add"           // SET s = s + ?
	SetRemove       Kind = "set_remove"        // SET s = s - ?
	MapPut          Kind = "map_put"           // SET m[?] = ?
	MapRemove       Kind = "map_remove"        // DELETE m[?] FROM …
	UDTFieldSet     Kind = "udt_field_set"     // SET addr.city = ?
	ReplaceValue    Kind = "replace_value"     // SET col = ? for a collection or UDT
)

// Change is one edit to one row. Values are in the grid's JSON encoding, so a
// key can be echoed straight from the result row it was read from.
type Change struct {
	Kind Kind `json:"kind"`
	// Key holds the primary key values by column name. Changes to static
	// columns use the partition key only.
	Key map[string]json.RawMessage `json:"key,omitempty"`
	// Column is the column being changed (not used by insert_row and delete_row).
	Column string `json:"column,omitempty"`
	// Field names the UDT field for udt_field_set.
	Field string `json:"field,omitempty"`
	// Index is the list position for list_set_index and list_remove_index.
	Index *int `json:"index,omitempty"`
	// Value is the new value; for list_append, list_prepend, set_add and
	// set_remove it is an array of elements, and for counter_delta a number.
	Value json.RawMessage `json:"value,omitempty"`
	// MapKey is the entry key for map_put and map_remove.
	MapKey json.RawMessage `json:"map_key,omitempty"`
	// Values holds the column values of insert_row; null values are omitted.
	Values map[string]json.RawMessage `json:"values,omitempty"`
	// IfNotExists makes an insert_row conditional.
	IfNotExists bool `json:"if_not_exists,omitempty"`
}

// Statement is one compiled change.
type Statement struct {
	Index   int    `json:"index"`
	Kind    Kind   `json:"kind"`
	CQL     string `json:"cql"`
	Preview string `json:"preview"`
	Summary string `json:"summary"`
	// Args are the values bound to the ? markers in CQL.
	Args []any `json:"-"`
}

// ChangeError is a problem with one change.
type ChangeError struct {
	Index   int    `json:"index"`
	Message string `json:"message"`
}

// ValidationError lists every invalid change in a request.
type ValidationError struct{ Errors []ChangeError }

func (e *ValidationError) Error() string {
	if len(e.Errors) == 0 {
		return "invalid changes"
	}
	return fmt.Sprintf("change %d: %s", e.Errors[0].Index+1, e.Errors[0].Message)
}

// ErrTableNotFound is returned when the keyspace or table is not in the snapshot.
var ErrTableNotFound = errors.New("table not found")

// ReadOnlyError is returned for materialized views and system keyspaces.
type ReadOnlyError struct{ Reason string }

func (e *ReadOnlyError) Error() string { return e.Reason }
