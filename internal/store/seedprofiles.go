package store

import (
	"database/sql"
	"errors"
	"time"
)

// SeedProfile is a saved seed configuration for one table.
type SeedProfile struct {
	ID        int64  `json:"id"`
	Profile   string `json:"-"`
	Keyspace  string `json:"keyspace"`
	Table     string `json:"table"`
	Name      string `json:"name"`
	Config    string `json:"-"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// ErrSeedProfileExists is returned when a name is already taken for the table.
var ErrSeedProfileExists = errors.New("seed profile already exists")

// ErrSeedProfileNotFound is returned for an unknown seed profile id.
var ErrSeedProfileNotFound = errors.New("seed profile not found")

func nowText() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }

// SaveSeedProfile inserts p, or replaces the config of the existing one of the
// same name when overwrite is set.
func (s *Store) SaveSeedProfile(p SeedProfile, overwrite bool) (SeedProfile, error) {
	now := nowText()
	var id int64
	err := s.db.QueryRow(`SELECT id FROM seed_profiles WHERE profile=? AND keyspace=? AND table_name=? AND name=?`,
		p.Profile, p.Keyspace, p.Table, p.Name).Scan(&id)
	switch {
	case err == nil:
		if !overwrite {
			return SeedProfile{}, ErrSeedProfileExists
		}
		if _, err := s.db.Exec(`UPDATE seed_profiles SET config=?, updated_at=? WHERE id=?`, p.Config, now, id); err != nil {
			return SeedProfile{}, err
		}
	case errors.Is(err, sql.ErrNoRows):
		res, err := s.db.Exec(`INSERT INTO seed_profiles (profile, keyspace, table_name, name, config, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`, p.Profile, p.Keyspace, p.Table, p.Name, p.Config, now, now)
		if err != nil {
			return SeedProfile{}, err
		}
		if id, err = res.LastInsertId(); err != nil {
			return SeedProfile{}, err
		}
	default:
		return SeedProfile{}, err
	}
	return s.GetSeedProfile(p.Profile, id)
}

// GetSeedProfile returns one profile by id.
func (s *Store) GetSeedProfile(profile string, id int64) (SeedProfile, error) {
	var p SeedProfile
	err := s.db.QueryRow(`SELECT id, profile, keyspace, table_name, name, config, created_at, updated_at
		FROM seed_profiles WHERE profile=? AND id=?`, profile, id).
		Scan(&p.ID, &p.Profile, &p.Keyspace, &p.Table, &p.Name, &p.Config, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return p, ErrSeedProfileNotFound
	}
	return p, err
}

// ListSeedProfiles returns the saved profiles of one table, by name.
func (s *Store) ListSeedProfiles(profile, keyspace, table string) ([]SeedProfile, error) {
	rows, err := s.db.Query(`SELECT id, profile, keyspace, table_name, name, config, created_at, updated_at
		FROM seed_profiles WHERE profile=? AND keyspace=? AND table_name=? ORDER BY name COLLATE NOCASE`, profile, keyspace, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SeedProfile{}
	for rows.Next() {
		var p SeedProfile
		if err := rows.Scan(&p.ID, &p.Profile, &p.Keyspace, &p.Table, &p.Name, &p.Config, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// DeleteSeedProfile removes a profile; it reports whether one was deleted.
func (s *Store) DeleteSeedProfile(profile string, id int64) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM seed_profiles WHERE profile=? AND id=?`, profile, id)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}
