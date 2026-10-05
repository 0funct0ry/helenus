// Package history derives the log fields and a best-effort reverse script for a
// DDL statement issued from the UI (SPEC §9.15).
package history

import (
	"strings"

	"github.com/0funct0ry/helenus/internal/cql"
	"github.com/0funct0ry/helenus/internal/schema"
)

// Notes attached to reverse scripts.
const (
	NoteRecreate    = "Recreates the object only; data is not restored"
	NoteDroppedData = "Dropped column data cannot be recovered"
	NoteNoUDTRemove = "Cassandra cannot remove UDT fields"
	NotePassword    = "Passwords are never stored"
	NoteTruncate    = "Truncated data cannot be restored"
	NoteNoReverse   = "No reverse available"
	passwordMask    = "'••••••'"
	passwordKeyword = "PASSWORD"
)

// Info identifies what a statement acts on.
type Info struct {
	// Action is the lower-case verb: create, alter, drop, grant, revoke or truncate.
	Action string
	// Kind is keyspace, table, view, type, function, aggregate, index, trigger, role or permission.
	Kind     string
	Keyspace string
	Name     string
}

// Parse reads the action and target of stmt. currentKS qualifies unqualified names.
func Parse(stmt, currentKS string) Info {
	st := parse(stmt, currentKS)
	return st.info
}

// Reverse returns the reverse CQL and a note for stmt, given the schema before it ran.
// The reverse is empty when none can be derived. currentKS qualifies unqualified names.
func Reverse(before *schema.Snapshot, currentKS, stmt string) (reverse, note string) {
	st := parse(stmt, currentKS)
	if st.info.Action == "" {
		return "", NoteNoReverse
	}
	r, n, ok := st.reverse(before)
	if !ok {
		if n == "" {
			n = NoteNoReverse
		}
		return "", n
	}
	return r, n
}

// MaskPassword replaces the literal after PASSWORD (optionally followed by =) with a fixed mask.
func MaskPassword(stmt string) string {
	toks := cql.Tokenize(stmt)
	var b strings.Builder
	last := 0
	for i := 0; i < len(toks); i++ {
		if toks[i].Upper() != passwordKeyword {
			continue
		}
		j := i + 1
		if j < len(toks) && toks[j].IsPunct('=') {
			j++
		}
		if j < len(toks) && toks[j].Kind == cql.TokString {
			b.WriteString(stmt[last:toks[j].Start])
			b.WriteString(passwordMask)
			last = toks[j].End
			i = j
		}
	}
	b.WriteString(stmt[last:])
	return b.String()
}
