package store

import (
	"database/sql"
	"errors"
	"strings"
)

// User is a web UI account (SPEC §13).
type User struct {
	ID           int64
	Username     string
	PasswordHash string
	TokenVersion int64
	CreatedAt    string
	LastLoginAt  string
}

// ErrUserExists is returned when the username is taken (case-insensitively).
var ErrUserExists = errors.New("user already exists")

// ErrUserNotFound is returned for an unknown user.
var ErrUserNotFound = errors.New("user not found")

const userCols = `id, username, password_hash, token_version, created_at, COALESCE(last_login_at, '')`

func scanUser(r interface{ Scan(...any) error }) (User, error) {
	var u User
	err := r.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.TokenVersion, &u.CreatedAt, &u.LastLoginAt)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrUserNotFound
	}
	return u, err
}

// CreateUser inserts a user with an already-hashed password.
func (s *Store) CreateUser(username, hash string) (User, error) {
	res, err := s.db.Exec(`INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)`, username, hash, nowText())
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return User{}, ErrUserExists
		}
		return User{}, err
	}
	id, _ := res.LastInsertId()
	return s.UserByID(id)
}

// UserByName looks a user up case-insensitively.
func (s *Store) UserByName(username string) (User, error) {
	return scanUser(s.db.QueryRow(`SELECT `+userCols+` FROM users WHERE username = ?`, username))
}

// UserByID looks a user up by id.
func (s *Store) UserByID(id int64) (User, error) {
	return scanUser(s.db.QueryRow(`SELECT `+userCols+` FROM users WHERE id = ?`, id))
}

// ListUsers returns every user ordered by name.
func (s *Store) ListUsers() ([]User, error) {
	rows, err := s.db.Query(`SELECT ` + userCols + ` FROM users ORDER BY username`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// CountUsers reports how many users exist.
func (s *Store) CountUsers() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

// SetPassword replaces the hash and bumps token_version, signing the user out everywhere.
func (s *Store) SetPassword(username, hash string) error {
	return s.expectOne(s.db.Exec(`UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE username = ?`, hash, username))
}

// BumpTokenVersion revokes every session of the user.
func (s *Store) BumpTokenVersion(id int64) error {
	return s.expectOne(s.db.Exec(`UPDATE users SET token_version = token_version + 1 WHERE id = ?`, id))
}

// DeleteUser removes the user and their saved UI state and queries.
func (s *Store) DeleteUser(username string) error {
	u, err := s.UserByName(username)
	if err != nil {
		return err
	}
	if _, err := s.db.Exec(`DELETE FROM ui_state WHERE user_id = ?`, u.ID); err != nil {
		return err
	}
	if _, err := s.db.Exec(`DELETE FROM saved_queries WHERE user_id = ?`, u.ID); err != nil {
		return err
	}
	return s.expectOne(s.db.Exec(`DELETE FROM users WHERE id = ?`, u.ID))
}

// TouchLogin records a successful sign-in.
func (s *Store) TouchLogin(id int64) error {
	_, err := s.db.Exec(`UPDATE users SET last_login_at = ? WHERE id = ?`, nowText(), id)
	return err
}

func (s *Store) expectOne(res sql.Result, err error) error {
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrUserNotFound
	}
	return nil
}

// Setting returns a settings value, or "" and false when unset.
func (s *Store) Setting(key string) (string, bool, error) {
	var v string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	return v, err == nil, err
}

// SetSettingIfAbsent stores value unless the key exists, and returns the stored value.
func (s *Store) SetSettingIfAbsent(key, value string) (string, error) {
	if _, err := s.db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, key, value); err != nil {
		return "", err
	}
	v, _, err := s.Setting(key)
	return v, err
}

// UIState returns the saved JSON state for the user and profile ("" when none).
func (s *Store) UIState(userID int64, profile string) (string, error) {
	var v string
	err := s.db.QueryRow(`SELECT state FROM ui_state WHERE user_id = ? AND profile = ?`, userID, profile).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return v, err
}

// PutUIState upserts the JSON state for the user and profile.
func (s *Store) PutUIState(userID int64, profile, state string) error {
	_, err := s.db.Exec(`INSERT INTO ui_state (user_id, profile, state, updated_at) VALUES (?, ?, ?, ?)
		ON CONFLICT(user_id, profile) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`, userID, profile, state, nowText())
	return err
}
