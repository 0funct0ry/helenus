// Package conn builds gocql sessions from resolved profiles, caches them per
// profile, and reports cluster information and staged connection tests.
package conn

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"os"
	"time"

	gocql "github.com/apache/cassandra-gocql-driver/v2"

	"github.com/0funct0ry/helenus/internal/astra"
	"github.com/0funct0ry/helenus/internal/config"
)

// InsecureWarning is shown on every connect when verification is disabled (SPEC §6.3).
const InsecureWarning = "TLS certificate verification is disabled (insecure_skip_verify); the connection is not protected against interception"

// Built is a cluster configuration plus warnings for the caller to surface.
type Built struct {
	Cluster  *gocql.ClusterConfig
	Warnings []string
}

// clusterHook lets integration tests adjust the cluster config, e.g. to skip
// host discovery when Cassandra runs behind Docker port mapping.
var clusterHook func(*gocql.ClusterConfig)

// IsAstra reports whether the profile connects through a secure connect bundle.
func IsAstra(p config.Profile) bool { return p.Astra.SecureBundle != "" }

func duration(s, def string) (time.Duration, error) {
	if s == "" {
		s = def
	}
	d, err := time.ParseDuration(s)
	if err != nil || d <= 0 {
		return 0, fmt.Errorf("invalid duration %q", s)
	}
	return d, nil
}

// TLSConfig builds the TLS client config for a direct profile (SPEC §6.3).
func TLSConfig(p config.Profile) (*tls.Config, error) {
	cfg := &tls.Config{
		MinVersion:         tls.VersionTLS12,
		InsecureSkipVerify: p.TLS.InsecureSkipVerify, //nolint:gosec // explicit user opt-in, warned about
		ServerName:         p.TLS.ServerName,
	}
	if p.TLS.CACert != "" {
		pem, err := os.ReadFile(p.TLS.CACert)
		if err != nil {
			return nil, fmt.Errorf("reading ca_cert: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("ca_cert %s contains no certificates", p.TLS.CACert)
		}
		cfg.RootCAs = pool
	}
	if (p.TLS.Cert == "") != (p.TLS.Key == "") {
		return nil, errors.New("tls.cert and tls.key must be set together")
	}
	if p.TLS.Cert != "" {
		pair, err := tls.LoadX509KeyPair(p.TLS.Cert, p.TLS.Key)
		if err != nil {
			return nil, fmt.Errorf("loading client certificate: %w", err)
		}
		cfg.Certificates = []tls.Certificate{pair}
	}
	return cfg, nil
}

// ClusterConfig builds the gocql configuration for a resolved profile
// (secrets already expanded; see config.Profile.ResolveSecrets).
func ClusterConfig(ctx context.Context, p config.Profile) (*Built, error) {
	p.ApplyDefaults()
	connectTimeout, err := duration(p.ConnectTimeout, "5s")
	if err != nil {
		return nil, fmt.Errorf("connect_timeout: %w", err)
	}
	requestTimeout, err := duration(p.RequestTimeout, "10s")
	if err != nil {
		return nil, fmt.Errorf("request_timeout: %w", err)
	}
	b := &Built{}
	var cl *gocql.ClusterConfig
	localDC := p.DC

	if IsAstra(p) {
		bundle, err := astra.OpenBundle(p.Astra.SecureBundle)
		if err != nil {
			return nil, err
		}
		md, err := bundle.FetchMetadata(ctx, connectTimeout)
		if err != nil {
			return nil, err
		}
		dialer, err := astra.NewHostDialer(bundle, md, connectTimeout)
		if err != nil {
			return nil, err
		}
		proxyHost, _, err := net.SplitHostPort(md.ContactInfo.SNIProxyAddress)
		if err != nil {
			return nil, fmt.Errorf("astra SNI proxy address: %w", err)
		}
		cl = gocql.NewCluster(proxyHost)
		cl.HostDialer = dialer
		if localDC == "" {
			localDC = md.ContactInfo.LocalDC
		}
		if p.Keyspace == "" {
			p.Keyspace = bundle.Keyspace
		}
		if p.Astra.Token == "" {
			return nil, errors.New("astra profiles need a token (astra.token or token_command)")
		}
		cl.Authenticator = gocql.PasswordAuthenticator{Username: "token", Password: p.Astra.Token}
	} else {
		cl = gocql.NewCluster(p.Hosts...)
		cl.Port = p.Port
		if p.Username != "" {
			cl.Authenticator = gocql.PasswordAuthenticator{Username: p.Username, Password: p.Password}
		}
		if p.TLS.Enabled {
			cfg, err := TLSConfig(p)
			if err != nil {
				return nil, err
			}
			cl.SslOpts = &gocql.SslOptions{Config: cfg}
			if p.TLS.InsecureSkipVerify {
				b.Warnings = append(b.Warnings, InsecureWarning)
			}
		}
	}

	cl.Keyspace = p.Keyspace
	cl.ConnectTimeout = connectTimeout
	cl.Timeout = requestTimeout
	if p.ProtocolVersion > 0 {
		cl.ProtoVersion = p.ProtocolVersion
	}
	cons, err := gocql.ParseConsistencyWrapper(p.Consistency)
	if err != nil {
		return nil, fmt.Errorf("consistency: %w", err)
	}
	cl.Consistency = cons
	serial, err := gocql.ParseConsistencyWrapper(p.SerialConsistency)
	if err != nil {
		return nil, fmt.Errorf("serial_consistency: %w", err)
	}
	cl.SerialConsistency = serial
	if localDC != "" {
		cl.PoolConfig.HostSelectionPolicy = gocql.DCAwareRoundRobinPolicy(localDC)
	}
	if clusterHook != nil {
		clusterHook(cl)
	}
	b.Cluster = cl
	return b, nil
}
