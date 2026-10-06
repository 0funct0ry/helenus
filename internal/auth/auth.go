// Package auth is the web UI sign-in: bcrypt passwords, HS256 session tokens
// revoked through users.token_version, and login rate limiting (SPEC §12.2).
package auth

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/0funct0ry/helenus/internal/store"
)

const (
	// BcryptCost is the bcrypt work factor.
	BcryptCost = 12
	// MinPasswordLen is the shortest accepted password, in characters.
	MinPasswordLen = 12
	// TokenLifetime is how long a session token lives.
	TokenLifetime = 12 * time.Hour
	// RefreshWindow is the remaining lifetime under which a token is silently reissued.
	RefreshWindow = 2 * time.Hour

	signingKeySetting = "jwt_signing_key"
)

// ErrInvalidCredentials is the uniform sign-in failure.
var ErrInvalidCredentials = errors.New("Incorrect username or password.") //nolint:staticcheck // user-facing sentence

// ErrInvalidToken is returned for a missing, malformed, expired or revoked token.
var ErrInvalidToken = errors.New("invalid session")

// ErrRateLimited is returned when a sign-in is throttled.
var ErrRateLimited = errors.New("Too many sign-in attempts. Try again in a minute.") //nolint:staticcheck // user-facing sentence

// ValidatePassword enforces the minimum length.
func ValidatePassword(p string) error {
	if utf8.RuneCountInString(p) < MinPasswordLen {
		return fmt.Errorf("password must be at least %d characters", MinPasswordLen)
	}
	return nil
}

// HashPassword hashes p with bcrypt at BcryptCost. bcrypt reads at most 72 bytes.
func HashPassword(p string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(p), BcryptCost)
	return string(h), err
}

// Service signs users in and verifies their sessions.
type Service struct {
	store *store.Store
	now   func() time.Time
	// Limiter throttles Login; replaceable in tests.
	Limiter *Limiter
	dummy   string
	key     []byte
}

// New builds a Service over st.
func New(st *store.Store) *Service {
	s := &Service{store: st, now: time.Now}
	s.Limiter = NewLimiter(5, time.Minute, s.clock)
	return s
}

func (s *Service) clock() time.Time { return s.now() }

// SetClock replaces the time source (tests).
func (s *Service) SetClock(f func() time.Time) { s.now = f }

// CreateUser validates the password, hashes it and stores the user.
func (s *Service) CreateUser(username, password string) error {
	if username == "" {
		return errors.New("username is required")
	}
	if err := ValidatePassword(password); err != nil {
		return err
	}
	h, err := HashPassword(password)
	if err != nil {
		return err
	}
	_, err = s.store.CreateUser(username, h)
	return err
}

// SetPassword changes the password and signs the user out everywhere.
func (s *Service) SetPassword(username, password string) error {
	if err := ValidatePassword(password); err != nil {
		return err
	}
	h, err := HashPassword(password)
	if err != nil {
		return err
	}
	return s.store.SetPassword(username, h)
}

// Login checks the credentials for ip and username, rate limited per IP and per username.
// Every failure other than throttling returns ErrInvalidCredentials.
func (s *Service) Login(ip, username, password string) (store.User, error) {
	if !s.Limiter.Allow("ip:"+ip) || !s.Limiter.Allow("user:"+lower(username)) {
		return store.User{}, ErrRateLimited
	}
	u, err := s.store.UserByName(username)
	if err != nil {
		if !errors.Is(err, store.ErrUserNotFound) {
			return store.User{}, err
		}
		// Burn the same time as a real comparison so unknown users are not distinguishable.
		if s.dummy == "" {
			s.dummy, _ = HashPassword("dummy-password-for-timing")
		}
		_ = bcrypt.CompareHashAndPassword([]byte(s.dummy), []byte(password))
		return store.User{}, ErrInvalidCredentials
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) != nil {
		return store.User{}, ErrInvalidCredentials
	}
	_ = s.store.TouchLogin(u.ID)
	return u, nil
}

func (s *Service) signingKey() ([]byte, error) {
	if s.key != nil {
		return s.key, nil
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, err
	}
	v, err := s.store.SetSettingIfAbsent(signingKeySetting, hex.EncodeToString(raw))
	if err != nil {
		return nil, err
	}
	k, err := hex.DecodeString(v)
	if err != nil {
		return nil, fmt.Errorf("stored signing key: %w", err)
	}
	s.key = k
	return k, nil
}

// Issue creates a token for u valid for TokenLifetime.
func (s *Service) Issue(u store.User) (string, time.Time, error) {
	key, err := s.signingKey()
	if err != nil {
		return "", time.Time{}, err
	}
	now := s.now()
	exp := now.Add(TokenLifetime)
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": strconv.FormatInt(u.ID, 10),
		"ver": u.TokenVersion,
		"iat": now.Unix(),
		"exp": exp.Unix(),
	})
	signed, err := tok.SignedString(key)
	return signed, exp, err
}

// Session is a verified token.
type Session struct {
	User    store.User
	Expires time.Time
}

// NeedsRefresh reports whether less than RefreshWindow remains.
func (s *Service) NeedsRefresh(sess Session) bool { return sess.Expires.Sub(s.now()) < RefreshWindow }

// Verify checks signature, expiry and that the token's version matches the user's.
func (s *Service) Verify(token string) (Session, error) {
	key, err := s.signingKey()
	if err != nil {
		return Session{}, err
	}
	var claims jwt.MapClaims
	_, err = jwt.ParseWithClaims(token, &claims, func(*jwt.Token) (any, error) { return key, nil },
		jwt.WithValidMethods([]string{"HS256"}), jwt.WithTimeFunc(s.now), jwt.WithExpirationRequired())
	if err != nil {
		return Session{}, ErrInvalidToken
	}
	sub, _ := claims["sub"].(string)
	id, err := strconv.ParseInt(sub, 10, 64)
	if err != nil {
		return Session{}, ErrInvalidToken
	}
	ver, _ := claims["ver"].(float64)
	exp, _ := claims.GetExpirationTime()
	u, err := s.store.UserByID(id)
	if err != nil || u.TokenVersion != int64(ver) {
		return Session{}, ErrInvalidToken
	}
	return Session{User: u, Expires: exp.Time}, nil
}

// Revoke signs the user out of every session.
func (s *Service) Revoke(userID int64) error { return s.store.BumpTokenVersion(userID) }
