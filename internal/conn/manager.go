package conn

import (
	"context"
	"crypto/sha256"
	"fmt"
	"sync"

	gocql "github.com/apache/cassandra-gocql-driver/v2"

	"github.com/0funct0ry/helenus/internal/config"
)

// Open resolves secrets, builds the cluster config and opens a session.
func Open(ctx context.Context, p config.Profile) (*gocql.Session, []string, error) {
	rp, err := p.ResolveSecrets(ctx)
	if err != nil {
		return nil, nil, err
	}
	built, err := ClusterConfig(ctx, rp)
	if err != nil {
		return nil, nil, err
	}
	s, err := built.Cluster.CreateSession()
	if err != nil {
		return nil, built.Warnings, err
	}
	return s, built.Warnings, nil
}

type entry struct {
	session     *gocql.Session
	fingerprint string
	warnings    []string
}

// Manager holds at most one session per profile name, created lazily and
// closed when the profile changes, is removed, or the process exits (SPEC §6.1).
type Manager struct {
	mu      sync.Mutex
	entries map[string]*entry
	// open creates sessions; replaceable in tests.
	open func(context.Context, config.Profile) (*gocql.Session, []string, error)
}

// NewManager returns an empty Manager.
func NewManager() *Manager {
	return &Manager{entries: map[string]*entry{}, open: Open}
}

func fingerprint(p config.Profile) string {
	return fmt.Sprintf("%x", sha256.Sum256(fmt.Appendf(nil, "%#v", p)))
}

// Session returns the cached session for name, reopening it if p changed.
// The returned warnings (e.g. insecure TLS) apply to the session.
func (m *Manager) Session(ctx context.Context, name string, p config.Profile) (*gocql.Session, []string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	fp := fingerprint(p)
	if e, ok := m.entries[name]; ok {
		if e.fingerprint == fp && !e.session.Closed() {
			return e.session, e.warnings, nil
		}
		e.session.Close()
		delete(m.entries, name)
	}
	s, warnings, err := m.open(ctx, p)
	if err != nil {
		return nil, warnings, err
	}
	m.entries[name] = &entry{session: s, fingerprint: fp, warnings: warnings}
	return s, warnings, nil
}

// Connected reports whether name has an open session.
func (m *Manager) Connected(name string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.entries[name]
	return ok && !e.session.Closed()
}

// Close closes and forgets the session for name, if any.
func (m *Manager) Close(name string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if e, ok := m.entries[name]; ok {
		e.session.Close()
		delete(m.entries, name)
	}
}

// CloseAll closes every session.
func (m *Manager) CloseAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for name, e := range m.entries {
		e.session.Close()
		delete(m.entries, name)
	}
}
