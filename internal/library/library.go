// Package library is the saved-query library shared by the shell and the web
// UI. Both front ends go through it; neither touches the table directly.
package library

import (
	"errors"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/0funct0ry/helenus/internal/store"
)

// MaxTextBytes is the largest query text the library accepts.
const MaxTextBytes = 1 << 20

// MaxNameLen is the longest name in characters.
const MaxNameLen = 200

var (
	// ErrQueryExists: the name is taken in the same scope.
	ErrQueryExists = store.ErrSavedQueryExists
	// ErrQueryNotFound: unknown or invisible query.
	ErrQueryNotFound = store.ErrSavedQueryNotFound
	// ErrQueryConflict: the expected version is stale.
	ErrQueryConflict = store.ErrSavedQueryConflict
	// ErrTooLarge: the text exceeds MaxTextBytes.
	ErrTooLarge = errors.New("query text is larger than 1 MiB")
)

// InvalidNameError reports why a name was rejected.
type InvalidNameError struct{ Reason string }

func (e *InvalidNameError) Error() string { return "invalid name: " + e.Reason }

// ErrInvalidName matches every *InvalidNameError with errors.Is.
var ErrInvalidName = &InvalidNameError{}

// Is lets errors.Is(err, ErrInvalidName) match any InvalidNameError.
func (e *InvalidNameError) Is(target error) bool {
	_, ok := target.(*InvalidNameError)
	return ok
}

// ConflictError wraps ErrQueryConflict with the row as it is now.
type ConflictError struct{ Current Query }

func (e *ConflictError) Error() string { return ErrQueryConflict.Error() }

// Unwrap makes errors.Is(err, ErrQueryConflict) true.
func (e *ConflictError) Unwrap() error { return ErrQueryConflict }

// Query is a saved query as the front ends see it.
type Query struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Text      string `json:"text,omitempty"`
	Global    bool   `json:"global"`
	Version   int64  `json:"version"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// Library is a view of the saved queries of one owner (0 = the local owner).
type Library struct {
	Store *store.Store
	Owner int64
}

func toQuery(q store.SavedQuery) Query {
	return Query{ID: q.ID, Name: q.Name, Text: q.Text, Global: q.Profile == "",
		Version: q.Version, CreatedAt: q.CreatedAt, UpdatedAt: q.UpdatedAt}
}

// NormalizeName trims the name and its segments and validates it.
func NormalizeName(name string) (string, error) {
	name = strings.TrimSpace(name)
	// Names carry no extension; tab titles and downloads add ".cql".
	if len(name) >= 4 && strings.EqualFold(name[len(name)-4:], ".cql") {
		name = strings.TrimSpace(name[:len(name)-4])
	}
	if name == "" {
		return "", &InvalidNameError{"name is empty"}
	}
	if utf8.RuneCountInString(name) > MaxNameLen {
		return "", &InvalidNameError{fmt.Sprintf("name is longer than %d characters", MaxNameLen)}
	}
	for _, r := range name {
		if r == '\\' {
			return "", &InvalidNameError{"name must not contain \\"}
		}
		if unicode.IsControl(r) {
			return "", &InvalidNameError{"name must not contain control characters"}
		}
	}
	if strings.HasPrefix(name, "/") || strings.HasSuffix(name, "/") {
		return "", &InvalidNameError{"name must not start or end with /"}
	}
	segs := strings.Split(name, "/")
	for i, s := range segs {
		s = strings.TrimSpace(s)
		if s == "" {
			return "", &InvalidNameError{"name must not have an empty folder"}
		}
		segs[i] = s
	}
	return strings.Join(segs, "/"), nil
}

func scope(profile string, global bool) string {
	if global {
		return ""
	}
	return profile
}

// List returns the profile's queries plus global ones, without text.
func (l Library) List(profile, filter string) ([]Query, error) {
	rows, err := l.Store.ListSavedQueries(l.Owner, profile, filter)
	if err != nil {
		return nil, err
	}
	out := make([]Query, len(rows))
	for i, r := range rows {
		out[i] = toQuery(r)
	}
	return out, nil
}

// Get returns one query with its text.
func (l Library) Get(profile string, id int64) (Query, error) {
	q, err := l.Store.GetSavedQuery(l.Owner, profile, id)
	return toQuery(q), err
}

// FindByName looks a name up in the profile first, then globally; globalOnly
// skips the profile.
func (l Library) FindByName(profile, name string, globalOnly bool) (Query, error) {
	rows, err := l.List(profile, "")
	if err != nil {
		return Query{}, err
	}
	var global *Query
	for i, r := range rows {
		if !strings.EqualFold(r.Name, strings.TrimSpace(name)) {
			continue
		}
		if r.Global {
			global = &rows[i]
		} else if !globalOnly {
			return l.Get(profile, r.ID)
		}
	}
	if global != nil {
		return l.Get(profile, global.ID)
	}
	return Query{}, ErrQueryNotFound
}

// Create saves a new query at version 1.
func (l Library) Create(profile, name, text string, global bool) (Query, error) {
	name, err := NormalizeName(name)
	if err != nil {
		return Query{}, err
	}
	if len(text) > MaxTextBytes {
		return Query{}, ErrTooLarge
	}
	q, err := l.Store.CreateSavedQuery(store.SavedQuery{Owner: l.Owner, Profile: scope(profile, global), Name: name, Text: text})
	return toQuery(q), err
}

// Update replaces name, text and scope when the version still matches
// (expectedVersion 0 overwrites regardless). A stale version returns a
// *ConflictError holding the current row.
func (l Library) Update(profile string, id, expectedVersion int64, name, text string, global bool) (Query, error) {
	name, err := NormalizeName(name)
	if err != nil {
		return Query{}, err
	}
	if len(text) > MaxTextBytes {
		return Query{}, ErrTooLarge
	}
	q, err := l.Store.UpdateSavedQuery(l.Owner, profile, id, expectedVersion, name, text, scope(profile, global))
	if errors.Is(err, store.ErrSavedQueryConflict) {
		cur, gerr := l.Get(profile, id)
		if gerr != nil {
			return Query{}, gerr
		}
		return Query{}, &ConflictError{Current: cur}
	}
	return toQuery(q), err
}

// Rename renames or moves a query, keeping its text.
func (l Library) Rename(profile string, id, expectedVersion int64, name string, global bool) (Query, error) {
	cur, err := l.Get(profile, id)
	if err != nil {
		return Query{}, err
	}
	return l.Update(profile, id, expectedVersion, name, cur.Text, global)
}

// Delete removes a query.
func (l Library) Delete(profile string, id int64) error {
	ok, err := l.Store.DeleteSavedQuery(l.Owner, profile, id)
	if err != nil {
		return err
	}
	if !ok {
		return ErrQueryNotFound
	}
	return nil
}

// Duplicate copies a query as "<name> copy", "<name> copy 2", …, in the same scope.
func (l Library) Duplicate(profile string, id int64) (Query, error) {
	src, err := l.Get(profile, id)
	if err != nil {
		return Query{}, err
	}
	for n := 1; ; n++ {
		name := src.Name + " copy"
		if n > 1 {
			name = fmt.Sprintf("%s copy %d", src.Name, n)
		}
		q, err := l.Create(profile, name, src.Text, src.Global)
		if errors.Is(err, ErrQueryExists) {
			continue
		}
		return q, err
	}
}
