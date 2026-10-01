// Package astra connects to DataStax Astra DB with a secure connect bundle.
// The apache gocql driver does not read bundles, so this package parses the
// zip, asks the metadata service for the SNI proxy and contact points, and
// supplies a HostDialer that reaches each node through the proxy (SPEC §6.4).
package astra

import (
	"archive/zip"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"time"

	gocql "github.com/apache/cassandra-gocql-driver/v2"
)

// Bundle is a parsed secure connect bundle.
type Bundle struct {
	// Host and Port locate the metadata service.
	Host     string
	Port     int
	Keyspace string
	LocalDC  string
	CA       []byte
	Cert     []byte
	Key      []byte
}

type bundleConfig struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Keyspace string `json:"keyspace"`
	LocalDC  string `json:"localDC"`
}

const maxEntry = 1 << 20

// OpenBundle reads and validates the bundle zip at path.
func OpenBundle(path string) (*Bundle, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return nil, fmt.Errorf("opening secure connect bundle: %w", err)
	}
	defer zr.Close()
	return parseBundle(&zr.Reader)
}

// ParseBundle parses bundle bytes (used for uploads).
func ParseBundle(data []byte, size int64) (*Bundle, error) {
	zr, err := zip.NewReader(readerAt(data), size)
	if err != nil {
		return nil, fmt.Errorf("not a valid zip: %w", err)
	}
	return parseBundle(zr)
}

type readerAt []byte

func (r readerAt) ReadAt(p []byte, off int64) (int, error) {
	if off >= int64(len(r)) {
		return 0, io.EOF
	}
	n := copy(p, r[off:])
	if n < len(p) {
		return n, io.EOF
	}
	return n, nil
}

func parseBundle(zr *zip.Reader) (*Bundle, error) {
	files := map[string][]byte{}
	for _, f := range zr.File {
		switch f.Name {
		case "config.json", "ca.crt", "cert", "key":
			rc, err := f.Open()
			if err != nil {
				return nil, err
			}
			data, err := io.ReadAll(io.LimitReader(rc, maxEntry))
			rc.Close()
			if err != nil {
				return nil, err
			}
			files[f.Name] = data
		}
	}
	for _, name := range []string{"config.json", "ca.crt", "cert", "key"} {
		if len(files[name]) == 0 {
			return nil, fmt.Errorf("secure connect bundle is missing %s", name)
		}
	}
	var cfg bundleConfig
	if err := json.Unmarshal(files["config.json"], &cfg); err != nil {
		return nil, fmt.Errorf("bundle config.json: %w", err)
	}
	if cfg.Host == "" || cfg.Port == 0 {
		return nil, errors.New("bundle config.json has no metadata host and port")
	}
	return &Bundle{
		Host: cfg.Host, Port: cfg.Port, Keyspace: cfg.Keyspace, LocalDC: cfg.LocalDC,
		CA: files["ca.crt"], Cert: files["cert"], Key: files["key"],
	}, nil
}

// TLSConfig returns the client TLS config for the metadata service: the
// bundle CA, the client certificate, and the metadata host as server name.
func (b *Bundle) TLSConfig() (*tls.Config, error) {
	pair, err := tls.X509KeyPair(b.Cert, b.Key)
	if err != nil {
		return nil, fmt.Errorf("bundle client certificate: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(b.CA) {
		return nil, errors.New("bundle ca.crt contains no certificates")
	}
	return &tls.Config{
		Certificates: []tls.Certificate{pair},
		RootCAs:      pool,
		ServerName:   b.Host,
		MinVersion:   tls.VersionTLS12,
	}, nil
}

// ContactInfo is the cluster topology the metadata service returns.
type ContactInfo struct {
	TypeName        string   `json:"type"`
	LocalDC         string   `json:"local_dc"`
	SNIProxyAddress string   `json:"sni_proxy_address"`
	ContactPoints   []string `json:"contact_points"`
}

// Metadata is the metadata service response.
type Metadata struct {
	Version     int         `json:"version"`
	Region      string      `json:"region"`
	ContactInfo ContactInfo `json:"contact_info"`
}

// FetchMetadata calls https://<host>:<port>/metadata with the client certificate.
func (b *Bundle) FetchMetadata(ctx context.Context, timeout time.Duration) (*Metadata, error) {
	tlsCfg, err := b.TLSConfig()
	if err != nil {
		return nil, err
	}
	return b.fetchMetadata(ctx, tlsCfg, timeout)
}

func (b *Bundle) fetchMetadata(ctx context.Context, tlsCfg *tls.Config, timeout time.Duration) (*Metadata, error) {
	u := url.URL{Scheme: "https", Host: net.JoinHostPort(b.Host, fmt.Sprint(b.Port)), Path: "/metadata"}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: timeout, Transport: &http.Transport{TLSClientConfig: tlsCfg}}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("astra metadata service: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("astra metadata service returned %s", resp.Status)
	}
	var md Metadata
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxEntry)).Decode(&md); err != nil {
		return nil, fmt.Errorf("astra metadata response: %w", err)
	}
	if md.ContactInfo.SNIProxyAddress == "" || len(md.ContactInfo.ContactPoints) == 0 {
		return nil, errors.New("astra metadata response has no SNI proxy or contact points")
	}
	return &md, nil
}

// HostDialer dials every node through the SNI proxy, setting the TLS server
// name to the node's host ID. The proxy certificate is verified against the
// bundle CA for the metadata host name.
type HostDialer struct {
	ProxyAddress  string
	DefaultHostID string
	Timeout       time.Duration
	tlsBase       *tls.Config
	verifyName    string
	roots         *x509.CertPool
}

// NewHostDialer builds the dialer for a bundle and its metadata.
func NewHostDialer(b *Bundle, md *Metadata, timeout time.Duration) (*HostDialer, error) {
	cfg, err := b.TLSConfig()
	if err != nil {
		return nil, err
	}
	return &HostDialer{
		ProxyAddress:  md.ContactInfo.SNIProxyAddress,
		DefaultHostID: md.ContactInfo.ContactPoints[0],
		Timeout:       timeout,
		tlsBase:       cfg,
		verifyName:    b.Host,
		roots:         cfg.RootCAs,
	}, nil
}

// DialHost implements gocql.HostDialer.
func (d *HostDialer) DialHost(ctx context.Context, host *gocql.HostInfo) (*gocql.DialedHost, error) {
	id := host.HostID()
	if id == "" {
		id = d.DefaultHostID
	}
	dialer := &net.Dialer{Timeout: d.Timeout}
	raw, err := dialer.DialContext(ctx, "tcp", d.ProxyAddress)
	if err != nil {
		return nil, err
	}
	cfg := d.tlsBase.Clone()
	cfg.ServerName = id
	// The SNI is a host ID, which the proxy certificate does not carry, so the
	// chain is verified by hand against the metadata host name instead.
	cfg.InsecureSkipVerify = true
	cfg.VerifyConnection = func(cs tls.ConnectionState) error {
		opts := x509.VerifyOptions{Roots: d.roots, DNSName: d.verifyName, Intermediates: x509.NewCertPool()}
		for _, c := range cs.PeerCertificates[1:] {
			opts.Intermediates.AddCert(c)
		}
		_, err := cs.PeerCertificates[0].Verify(opts)
		return err
	}
	conn := tls.Client(raw, cfg)
	if err := conn.HandshakeContext(ctx); err != nil {
		raw.Close()
		return nil, err
	}
	return &gocql.DialedHost{Conn: conn, DisableCoalesce: true}, nil
}
