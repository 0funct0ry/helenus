package store

import (
	"strings"
	"time"
)

// Change is one logged UI DDL statement.
type Change struct {
	ID          int64  `json:"id"`
	Profile     string `json:"-"`
	Keyspace    string `json:"keyspace"`
	ObjectKind  string `json:"object_kind"`
	ObjectName  string `json:"object_name"`
	Action      string `json:"action"`
	Statement   string `json:"statement"`
	Reverse     string `json:"reverse"`
	ReverseNote string `json:"reverse_note"`
	Status      string `json:"status"`
	Error       string `json:"error"`
	DurationMS  int64  `json:"duration_ms"`
	CreatedAt   string `json:"created_at"`
}

// AddChange stores c (CreatedAt defaults to now, UTC) and returns its id.
func (s *Store) AddChange(c Change) (int64, error) {
	if c.CreatedAt == "" {
		c.CreatedAt = time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	}
	res, err := s.db.Exec(`INSERT INTO schema_changes
		(profile, keyspace, object_kind, object_name, action, statement, reverse, reverse_note, status, error, duration_ms, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		c.Profile, c.Keyspace, c.ObjectKind, c.ObjectName, c.Action, c.Statement,
		nullable(c.Reverse), nullable(c.ReverseNote), c.Status, nullable(c.Error), c.DurationMS, c.CreatedAt)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// ListChanges returns the profile's changes newest first. before > 0 returns only ids below it;
// q matches the statement or object name, case-insensitively.
func (s *Store) ListChanges(profile string, limit int, before int64, q string) ([]Change, error) {
	if limit <= 0 {
		limit = 50
	}
	query := `SELECT id, profile, COALESCE(keyspace,''), COALESCE(object_kind,''), COALESCE(object_name,''), action, statement,
		COALESCE(reverse,''), COALESCE(reverse_note,''), status, COALESCE(error,''), COALESCE(duration_ms,0), created_at
		FROM schema_changes WHERE profile = ?`
	args := []any{profile}
	if before > 0 {
		query += " AND id < ?"
		args = append(args, before)
	}
	if q = strings.TrimSpace(q); q != "" {
		like := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q) + "%"
		query += ` AND (statement LIKE ? ESCAPE '\' OR object_name LIKE ? ESCAPE '\')`
		args = append(args, like, like)
	}
	query += " ORDER BY id DESC LIMIT ?"
	args = append(args, limit)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []Change{}
	for rows.Next() {
		var c Change
		if err := rows.Scan(&c.ID, &c.Profile, &c.Keyspace, &c.ObjectKind, &c.ObjectName, &c.Action, &c.Statement,
			&c.Reverse, &c.ReverseNote, &c.Status, &c.Error, &c.DurationMS, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ClearChanges deletes the profile's changes and returns how many were removed.
func (s *Store) ClearChanges(profile string) (int64, error) {
	res, err := s.db.Exec(`DELETE FROM schema_changes WHERE profile = ?`, profile)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
