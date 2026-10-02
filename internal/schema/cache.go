package schema

import (
	"context"
	"sync"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
)

// Cache keeps one Snapshot per profile. Snapshots only change on an explicit Refresh.
type Cache struct {
	mu    sync.Mutex
	snaps map[string]*Snapshot
	// build reads a snapshot; replaceable in tests.
	build func(context.Context, *gocql.Session) (*Snapshot, error)
}

// NewCache returns an empty Cache.
func NewCache() *Cache { return &Cache{snaps: map[string]*Snapshot{}, build: Build} }

// Get returns the cached snapshot for name, reading it on first use.
func (c *Cache) Get(ctx context.Context, name string, s *gocql.Session) (*Snapshot, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if snap, ok := c.snaps[name]; ok {
		return snap, nil
	}
	return c.load(ctx, name, s)
}

// Refresh re-reads the schema and replaces the cached snapshot.
func (c *Cache) Refresh(ctx context.Context, name string, s *gocql.Session) (*Snapshot, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.load(ctx, name, s)
}

func (c *Cache) load(ctx context.Context, name string, s *gocql.Session) (*Snapshot, error) {
	snap, err := c.build(ctx, s)
	if err != nil {
		return nil, err
	}
	c.snaps[name] = snap
	return snap, nil
}

// Invalidate forgets the snapshot for name.
func (c *Cache) Invalidate(name string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.snaps, name)
}

// Describe renders t for name's cluster, using the cached snapshot for the version check and the
// generated-DDL fallback.
func (c *Cache) Describe(ctx context.Context, name string, s *gocql.Session, t Target, currentKS string) (string, error) {
	snap, err := c.Get(ctx, name, s)
	if err != nil {
		return "", err
	}
	return Describe(ctx, s, snap, t, currentKS)
}
