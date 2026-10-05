package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
)

// ExportPreset is a saved export configuration. Profile is empty for presets
// shared by all profiles; Columns is nil for "all columns".
type ExportPreset struct {
	ID        int64    `json:"id"`
	Profile   string   `json:"profile"`
	Name      string   `json:"name"`
	Format    string   `json:"format"`
	Options   string   `json:"-"`
	Columns   []string `json:"columns"`
	CreatedAt string   `json:"created_at"`
	UpdatedAt string   `json:"updated_at"`
}

// ErrExportPresetExists is returned when the name is taken in the same scope.
var ErrExportPresetExists = errors.New("export preset already exists")

// ErrExportPresetNotFound is returned for an unknown preset id.
var ErrExportPresetNotFound = errors.New("export preset not found")

// encodeColumns stores nil as SQL NULL and a list as a JSON array.
func encodeColumns(cols []string) any {
	if cols == nil {
		return nil
	}
	var b strings.Builder
	b.WriteByte('[')
	for i, c := range cols {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(jsonString(c))
	}
	b.WriteByte(']')
	return b.String()
}

const presetCols = `id, COALESCE(profile,''), name, format, options, columns, created_at, updated_at`

type rowScanner interface{ Scan(dest ...any) error }

func scanPreset(r rowScanner) (ExportPreset, error) {
	var p ExportPreset
	var cols sql.NullString
	if err := r.Scan(&p.ID, &p.Profile, &p.Name, &p.Format, &p.Options, &cols, &p.CreatedAt, &p.UpdatedAt); err != nil {
		return p, err
	}
	if cols.Valid {
		list, err := decodeStringList(cols.String)
		if err != nil {
			return p, err
		}
		p.Columns = list
	}
	return p, nil
}

func isUnique(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint")
}

// CreateExportPreset inserts p (an empty Profile makes it global).
func (s *Store) CreateExportPreset(p ExportPreset) (ExportPreset, error) {
	now := nowText()
	res, err := s.db.Exec(`INSERT INTO export_presets (profile, name, format, options, columns, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, nullable(p.Profile), p.Name, p.Format, p.Options, encodeColumns(p.Columns), now, now)
	if isUnique(err) {
		return ExportPreset{}, ErrExportPresetExists
	}
	if err != nil {
		return ExportPreset{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return ExportPreset{}, err
	}
	return s.GetExportPreset(p.Profile, id)
}

// GetExportPreset returns a preset visible to profile (its own or a global one).
func (s *Store) GetExportPreset(profile string, id int64) (ExportPreset, error) {
	p, err := scanPreset(s.db.QueryRow(`SELECT `+presetCols+` FROM export_presets
		WHERE id = ? AND (profile = ? OR profile IS NULL)`, id, profile))
	if errors.Is(err, sql.ErrNoRows) {
		return p, ErrExportPresetNotFound
	}
	return p, err
}

// ListExportPresets returns the profile's presets and the global ones, by name.
func (s *Store) ListExportPresets(profile string) ([]ExportPreset, error) {
	rows, err := s.db.Query(`SELECT `+presetCols+` FROM export_presets
		WHERE profile = ? OR profile IS NULL ORDER BY name COLLATE NOCASE`, profile)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []ExportPreset{}
	for rows.Next() {
		p, err := scanPreset(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// UpdateExportPreset replaces the name, format, options and columns of preset id.
func (s *Store) UpdateExportPreset(profile string, id int64, p ExportPreset) (ExportPreset, error) {
	res, err := s.db.Exec(`UPDATE export_presets SET name=?, format=?, options=?, columns=?, updated_at=?
		WHERE id = ? AND (profile = ? OR profile IS NULL)`,
		p.Name, p.Format, p.Options, encodeColumns(p.Columns), nowText(), id, profile)
	if isUnique(err) {
		return ExportPreset{}, ErrExportPresetExists
	}
	if err != nil {
		return ExportPreset{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ExportPreset{}, ErrExportPresetNotFound
	}
	return s.GetExportPreset(profile, id)
}

// DeleteExportPreset removes a preset; it reports whether one was deleted.
func (s *Store) DeleteExportPreset(profile string, id int64) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM export_presets WHERE id = ? AND (profile = ? OR profile IS NULL)`, id, profile)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func decodeStringList(s string) ([]string, error) {
	var out []string
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return nil, err
	}
	if out == nil {
		out = []string{}
	}
	return out, nil
}
