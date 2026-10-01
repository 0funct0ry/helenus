package conn

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/0funct0ry/helenus/internal/astra"
	"github.com/0funct0ry/helenus/internal/config"
)

// Stage names reported by Test (SPEC §6.5).
const (
	StageDNS      = "dns"
	StageTCP      = "tcp"
	StageTLS      = "tls"
	StageMetadata = "metadata"
	StageAuth     = "auth"
	StageProtocol = "protocol"
)

// StageResult is the outcome of one connection stage.
type StageResult struct {
	Name   string `json:"name"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail,omitempty"`
}

// TestResult reports a temporary connection attempt.
type TestResult struct {
	OK          bool          `json:"ok"`
	FailedStage string        `json:"failed_stage,omitempty"`
	Error       string        `json:"error,omitempty"`
	Stages      []StageResult `json:"stages"`
	Info        *ClusterInfo  `json:"info,omitempty"`
	RTTMillis   float64       `json:"rtt_ms,omitempty"`
	Warnings    []string      `json:"warnings,omitempty"`
}

func (r *TestResult) pass(name, detail string) {
	r.Stages = append(r.Stages, StageResult{Name: name, OK: true, Detail: detail})
}

func (r *TestResult) fail(name string, err error) *TestResult {
	r.Stages = append(r.Stages, StageResult{Name: name, Detail: err.Error()})
	r.FailedStage, r.Error = name, err.Error()
	return r
}

// authMarkers identify authentication failures in driver error text.
var authMarkers = []string{"bad credentials", "authenticat", "username and/or password", "unauthorized", "password"}

// ClassifySessionError maps a session-creation error to the auth or protocol stage.
func ClassifySessionError(err error) string {
	msg := strings.ToLower(err.Error())
	for _, m := range authMarkers {
		if strings.Contains(msg, m) {
			return StageAuth
		}
	}
	return StageProtocol
}

// Test opens a temporary session for p and reports each stage: DNS, TCP, TLS,
// then authentication and protocol negotiation. It never caches the session.
func Test(ctx context.Context, p config.Profile) *TestResult {
	res := &TestResult{}
	start := time.Now()
	rp, err := p.ResolveSecrets(ctx)
	if err != nil {
		return res.fail(StageAuth, err)
	}
	rp.ApplyDefaults()
	connectTimeout, err := duration(rp.ConnectTimeout, "5s")
	if err != nil {
		return res.fail(StageProtocol, fmt.Errorf("connect_timeout: %w", err))
	}

	if IsAstra(rp) {
		b, err := astra.OpenBundle(rp.Astra.SecureBundle)
		if err != nil {
			return res.fail(StageMetadata, err)
		}
		if _, err := b.FetchMetadata(ctx, connectTimeout); err != nil {
			return res.fail(StageMetadata, err)
		}
		res.pass(StageMetadata, "secure connect bundle and metadata service")
	} else if failed := directStages(ctx, rp, connectTimeout, res); failed {
		return res
	}

	built, err := ClusterConfig(ctx, rp)
	if err != nil {
		return res.fail(StageProtocol, err)
	}
	res.Warnings = built.Warnings
	sess, err := built.Cluster.CreateSession()
	if err != nil {
		return res.fail(ClassifySessionError(err), err)
	}
	defer sess.Close()
	res.pass(StageAuth, "")
	info, err := Info(ctx, sess)
	if err != nil {
		return res.fail(StageProtocol, err)
	}
	res.pass(StageProtocol, "Cassandra "+info.ReleaseVersion)
	res.Info = info
	res.RTTMillis = float64(time.Since(start).Microseconds()) / 1000
	res.OK = true
	return res
}

// directStages runs DNS, TCP and TLS checks; a stage passes when any host passes.
func directStages(ctx context.Context, p config.Profile, timeout time.Duration, res *TestResult) (failed bool) {
	var resolved []string
	var lastErr error
	for _, h := range p.Hosts {
		if net.ParseIP(h) != nil {
			resolved = append(resolved, h)
			continue
		}
		rctx, cancel := context.WithTimeout(ctx, timeout)
		_, err := net.DefaultResolver.LookupHost(rctx, h)
		cancel()
		if err != nil {
			lastErr = err
			continue
		}
		resolved = append(resolved, h)
	}
	if len(resolved) == 0 {
		res.fail(StageDNS, lastErr)
		return true
	}
	res.pass(StageDNS, strings.Join(resolved, ", "))

	var reachable []string
	for _, h := range resolved {
		d := net.Dialer{Timeout: timeout}
		c, err := d.DialContext(ctx, "tcp", net.JoinHostPort(h, fmt.Sprint(p.Port)))
		if err != nil {
			lastErr = err
			continue
		}
		c.Close()
		reachable = append(reachable, h)
	}
	if len(reachable) == 0 {
		res.fail(StageTCP, lastErr)
		return true
	}
	res.pass(StageTCP, fmt.Sprintf("%d of %d hosts reachable on port %d", len(reachable), len(p.Hosts), p.Port))

	if !p.TLS.Enabled {
		return false
	}
	cfg, err := TLSConfig(p)
	if err != nil {
		res.fail(StageTLS, err)
		return true
	}
	for _, h := range reachable {
		if err := handshake(ctx, h, p.Port, cfg, timeout); err != nil {
			lastErr = err
			continue
		}
		res.pass(StageTLS, "handshake with "+h)
		return false
	}
	res.fail(StageTLS, lastErr)
	return true
}

func handshake(ctx context.Context, host string, port int, cfg *tls.Config, timeout time.Duration) error {
	c := cfg.Clone()
	if c.ServerName == "" {
		c.ServerName = host
	}
	d := net.Dialer{Timeout: timeout}
	raw, err := d.DialContext(ctx, "tcp", net.JoinHostPort(host, fmt.Sprint(port)))
	if err != nil {
		return err
	}
	defer raw.Close()
	hctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	conn := tls.Client(raw, c)
	if err := conn.HandshakeContext(hctx); err != nil {
		return errors.New(err.Error())
	}
	return nil
}
