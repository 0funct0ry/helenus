package shell

import (
	"context"
	"io"
	"os"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
	"golang.org/x/term"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/config"
	"github.com/0funct0ry/helenus/internal/conn"
	"github.com/0funct0ry/helenus/internal/exec"
	"github.com/0funct0ry/helenus/internal/schema"
	"github.com/0funct0ry/helenus/internal/trace"
)

// Dial opens (or reuses) the session for profile p and wraps it as a Backend.
// The returned warnings come from the connection (for example insecure TLS).
func Dial(ctx context.Context, mgr *conn.Manager, cache *schema.Cache, name string, p config.Profile) (*Backend, []string, error) {
	sess, warnings, err := mgr.Session(ctx, name, p)
	if err != nil {
		return nil, warnings, err
	}
	info, err := conn.Info(ctx, sess)
	if err != nil {
		return nil, warnings, err
	}
	port := p.Port
	if port == 0 {
		port = 9042
	}
	return &Backend{
		Name:        name,
		Exec:        exec.ForSession(sess, cache, name),
		Describer:   &sessionDescriber{name: name, sess: sess, cache: cache},
		Cluster:     info,
		Host:        p.Hosts[0],
		Port:        port,
		Keyspace:    p.Keyspace,
		Consistency: p.Consistency,
		Serial:      p.SerialConsistency,
		UDTFields:   udtFields(name, sess, cache),
		Tracer: func(ctx context.Context, id string) (*trace.Trace, error) {
			return trace.Fetch(ctx, trace.NewSource(sess), id, trace.PollWindow)
		},
		Schema: func(ctx context.Context) (*schema.Snapshot, error) {
			return cache.Get(ctx, name, sess)
		},
	}, warnings, nil
}

// sessionDescriber answers DESCRIBE from the live session.
type sessionDescriber struct {
	name  string
	sess  *gocql.Session
	cache *schema.Cache
}

func (d *sessionDescriber) Describe(ctx context.Context, t schema.Target, currentKS string) (string, error) {
	return d.cache.Describe(ctx, d.name, d.sess, t, currentKS)
}

func udtFields(name string, sess *gocql.Session, cache *schema.Cache) func(codec.UDTRef) map[string]codec.TypeDesc {
	return func(r codec.UDTRef) map[string]codec.TypeDesc {
		snap, err := cache.Get(context.Background(), name, sess)
		if err != nil {
			return nil
		}
		k := snap.Keyspace(r.Keyspace)
		if k == nil {
			return nil
		}
		u := k.Type(r.Name)
		if u == nil {
			return nil
		}
		m := make(map[string]codec.TypeDesc, len(u.Fields))
		for _, f := range u.Fields {
			m[f.Name] = f.Type
		}
		return m
	}
}

// IsTerminal reports whether r is an interactive terminal.
func IsTerminal(r any) bool {
	f, ok := r.(*os.File)
	return ok && term.IsTerminal(int(f.Fd()))
}

// TerminalWidth returns a width function for w: the terminal's columns, or 0
// (unlimited) when w is not a terminal.
func TerminalWidth(w io.Writer) func() int {
	return func() int {
		f, ok := w.(*os.File)
		if !ok {
			return 0
		}
		cols, _, err := term.GetSize(int(f.Fd()))
		if err != nil {
			return 0
		}
		return cols
	}
}
