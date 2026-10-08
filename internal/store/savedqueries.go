package store

import (
	"database/sql"
	"errors"
	"strings"
)

// SavedQuery is a named CQL text in the query library. Owner 0 is the local
// owner (no user); Profile is empty for global queries.
type SavedQuery struct {
	ID        int64  `json:"id"`
	Owner     int64  `json:"-"`
	Profile   string `json:"-"`
	Name      string `json:"name"`
	Text      string `json:"text"`
	Version   int64  `json:"version"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// ErrSavedQueryExists is returned when the name is taken in the same scope.
var ErrSavedQueryExists = errors.New("saved query already exists")

// ErrSavedQueryNotFound is returned for an unknown or invisible query id.
var ErrSavedQueryNotFound = errors.New("saved query not found")

// ErrSavedQueryConflict is returned by an update whose expected version is stale.
var ErrSavedQueryConflict = errors.New("saved query was changed elsewhere")

const savedCols = `id, COALESCE(user_id,0), COALESCE(profile,''), name, text, version, created_at, updated_at`

func scanSaved(r rowScanner) (SavedQuery, error) {
	var q SavedQuery
	err := r.Scan(&q.ID, &q.Owner, &q.Profile, &q.Name, &q.Text, &q.Version, &q.CreatedAt, &q.UpdatedAt)
	return q, err
}

// CreateSavedQuery inserts q at version 1.
func (s *Store) CreateSavedQuery(q SavedQuery) (SavedQuery, error) {
	now := nowText()
	var owner any
	if q.Owner != 0 {
		owner = q.Owner
	}
	res, err := s.db.Exec(`INSERT INTO saved_queries (user_id, profile, name, text, version, created_at, updated_at)
		VALUES (?, ?, ?, ?, 1, ?, ?)`, owner, nullable(q.Profile), q.Name, q.Text, now, now)
	if isUnique(err) {
		return SavedQuery{}, ErrSavedQueryExists
	}
	if err != nil {
		return SavedQuery{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return SavedQuery{}, err
	}
	return s.GetSavedQuery(q.Owner, q.Profile, id)
}

// GetSavedQuery returns a query owned by owner and visible to profile (its own or global).
func (s *Store) GetSavedQuery(owner int64, profile string, id int64) (SavedQuery, error) {
	q, err := scanSaved(s.db.QueryRow(`SELECT `+savedCols+` FROM saved_queries
		WHERE id = ? AND COALESCE(user_id,0) = ? AND (profile = ? OR profile IS NULL)`, id, owner, profile))
	if errors.Is(err, sql.ErrNoRows) {
		return q, ErrSavedQueryNotFound
	}
	return q, err
}

// ListSavedQueries returns the owner's queries for profile plus global ones,
// without text, sorted by name (case-insensitive), profile rows before global.
// filter is a case-insensitive substring of the name.
func (s *Store) ListSavedQueries(owner int64, profile, filter string) ([]SavedQuery, error) {
	rows, err := s.db.Query(`SELECT id, COALESCE(user_id,0), COALESCE(profile,''), name, '', version, created_at, updated_at
		FROM saved_queries WHERE COALESCE(user_id,0) = ? AND (profile = ? OR profile IS NULL)
		ORDER BY name COLLATE NOCASE, profile IS NULL`, owner, profile)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []SavedQuery{}
	f := strings.ToLower(filter)
	for rows.Next() {
		q, err := scanSaved(rows)
		if err != nil {
			return nil, err
		}
		if f == "" || strings.Contains(strings.ToLower(q.Name), f) {
			out = append(out, q)
		}
	}
	return out, rows.Err()
}

// UpdateSavedQuery sets name, text and scope (newProfile "" = global) of query
// id, visible from profile, when its version is expectedVersion (0 = any, used
// for forced overwrites). A stale version yields ErrSavedQueryConflict.
func (s *Store) UpdateSavedQuery(owner int64, profile string, id, expectedVersion int64, name, text, newProfile string) (SavedQuery, error) {
	q := `UPDATE saved_queries SET name=?, text=?, profile=?, version=version+1, updated_at=?
		WHERE id = ? AND COALESCE(user_id,0) = ? AND (profile = ? OR profile IS NULL)`
	args := []any{name, text, nullable(newProfile), nowText(), id, owner, profile}
	if expectedVersion != 0 {
		q += ` AND version = ?`
		args = append(args, expectedVersion)
	}
	res, err := s.db.Exec(q, args...)
	if isUnique(err) {
		return SavedQuery{}, ErrSavedQueryExists
	}
	if err != nil {
		return SavedQuery{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		if _, err := s.GetSavedQuery(owner, profile, id); err != nil {
			return SavedQuery{}, err
		}
		return SavedQuery{}, ErrSavedQueryConflict
	}
	return s.GetSavedQuery(owner, newProfile, id)
}

// DeleteSavedQuery removes a query; it reports whether one was deleted.
func (s *Store) DeleteSavedQuery(owner int64, profile string, id int64) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM saved_queries WHERE id = ? AND COALESCE(user_id,0) = ? AND (profile = ? OR profile IS NULL)`, id, owner, profile)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}
