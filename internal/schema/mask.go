package schema

import "strings"

// MaskedValue replaces the value of a sensitive system column.
const MaskedValue = "••••••"

// MaskedColumn reports whether a column of a system keyspace holds credentials
// (salted_hash or anything named *password*) and must never leave the server.
func MaskedColumn(keyspace, column string) bool {
	if !isSystem(keyspace) {
		return false
	}
	c := strings.ToLower(column)
	return c == "salted_hash" || strings.Contains(c, "password")
}
