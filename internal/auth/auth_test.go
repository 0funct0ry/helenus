package auth

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/0funct0ry/helenus/internal/store"
)

const goodPass = "correct horse battery"

func newService(t *testing.T) *Service {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "h.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return New(st)
}

func TestPasswordRules(t *testing.T) {
	s := newService(t)
	if err := s.CreateUser("alice", "short"); err == nil || !strings.Contains(err.Error(), "12") {
		t.Fatalf("short password accepted: %v", err)
	}
	if err := s.CreateUser("alice", goodPass); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateUser("ALICE", goodPass); !errors.Is(err, store.ErrUserExists) {
		t.Fatalf("usernames must be case-insensitive unique: %v", err)
	}
	u, _ := s.store.UserByName("alice")
	if !strings.HasPrefix(u.PasswordHash, "$2a$12$") {
		t.Fatalf("not bcrypt cost 12: %s", u.PasswordHash[:7])
	}
}

func TestLoginUniformFailure(t *testing.T) {
	s := newService(t)
	_ = s.CreateUser("alice", goodPass)
	_, e1 := s.Login("1.1.1.1", "alice", "wrong password!!")
	_, e2 := s.Login("1.1.1.1", "nobody", "wrong password!!")
	if !errors.Is(e1, ErrInvalidCredentials) || !errors.Is(e2, ErrInvalidCredentials) {
		t.Fatalf("got %v / %v", e1, e2)
	}
	if _, err := s.Login("1.1.1.1", "Alice", goodPass); err != nil {
		t.Fatal(err)
	}
}

func TestTokenLifecycleAndRevocation(t *testing.T) {
	s := newService(t)
	now := time.Now()
	s.SetClock(func() time.Time { return now })
	_ = s.CreateUser("alice", goodPass)
	u, _ := s.Login("ip", "alice", goodPass)
	tok, _, err := s.Issue(u)
	if err != nil {
		t.Fatal(err)
	}
	sess, err := s.Verify(tok)
	if err != nil || s.NeedsRefresh(sess) {
		t.Fatalf("fresh token: %v refresh=%v", err, s.NeedsRefresh(sess))
	}
	now = now.Add(10*time.Hour + time.Minute)
	sess, err = s.Verify(tok)
	if err != nil || !s.NeedsRefresh(sess) {
		t.Fatalf("aged token should verify and need refresh: %v", err)
	}
	now = now.Add(2 * time.Hour)
	if _, err := s.Verify(tok); err == nil {
		t.Fatal("expired token accepted")
	}
	now = time.Now()
	tok, _, _ = s.Issue(u)
	if err := s.SetPassword("alice", "another long passphrase"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Verify(tok); err == nil {
		t.Fatal("token survived passwd")
	}
	u, _ = s.store.UserByName("alice")
	tok, _, _ = s.Issue(u)
	_ = s.store.DeleteUser("alice")
	if _, err := s.Verify(tok); err == nil {
		t.Fatal("token survived remove")
	}
	if _, err := s.Verify("garbage"); err == nil {
		t.Fatal("garbage accepted")
	}
}

func TestRateLimit(t *testing.T) {
	s := newService(t)
	now := time.Now()
	s.SetClock(func() time.Time { return now })
	_ = s.CreateUser("alice", goodPass)
	for i := 0; i < 5; i++ {
		if _, err := s.Login("ip", "alice", "bad bad bad bad"); !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("attempt %d: %v", i, err)
		}
	}
	if _, err := s.Login("ip", "alice", goodPass); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("6th attempt: %v", err)
	}
	// Another IP, same username: still throttled per username.
	if _, err := s.Login("other", "ALICE", goodPass); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("per-username limit: %v", err)
	}
	// Same IP, different username: throttled per IP.
	if _, err := s.Login("ip", "bob", goodPass); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("per-IP limit: %v", err)
	}
	now = now.Add(61 * time.Second)
	if _, err := s.Login("ip", "alice", goodPass); err != nil {
		t.Fatalf("after window: %v", err)
	}
}
