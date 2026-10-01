package astra

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

type pki struct{ caPEM, certPEM, keyPEM []byte }

func makePKI(t *testing.T) pki {
	t.Helper()
	caKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	caTpl := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "test-ca"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign,
	}
	caDER, _ := x509.CreateCertificate(rand.Reader, caTpl, caTpl, &caKey.PublicKey, caKey)
	caCert, _ := x509.ParseCertificate(caDER)
	leaf := func(serial int64, ext []x509.ExtKeyUsage) ([]byte, []byte) {
		k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		tpl := &x509.Certificate{
			SerialNumber: big.NewInt(serial), Subject: pkix.Name{CommonName: "leaf"},
			NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
			DNSNames: []string{"localhost"}, IPAddresses: []net.IP{net.ParseIP("127.0.0.1")},
			ExtKeyUsage: ext, KeyUsage: x509.KeyUsageDigitalSignature,
		}
		der, _ := x509.CreateCertificate(rand.Reader, tpl, caCert, &k.PublicKey, caKey)
		kb, _ := x509.MarshalECPrivateKey(k)
		return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: kb})
	}
	cert, key := leaf(2, []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth, x509.ExtKeyUsageServerAuth})
	return pki{caPEM: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER}), certPEM: cert, keyPEM: key}
}

func makeZip(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, data := range files {
		w, _ := zw.Create(name)
		_, _ = w.Write(data)
	}
	zw.Close()
	return buf.Bytes()
}

func bundleFiles(p pki, host string, port int) map[string][]byte {
	cfg, _ := json.Marshal(map[string]any{"host": host, "port": port, "keyspace": "ks", "localDC": "dc1"})
	return map[string][]byte{"config.json": cfg, "ca.crt": p.caPEM, "cert": p.certPEM, "key": p.keyPEM}
}

func TestParseBundle(t *testing.T) {
	p := makePKI(t)
	data := makeZip(t, bundleFiles(p, "localhost", 443))
	b, err := ParseBundle(data, int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if b.Host != "localhost" || b.Port != 443 || b.Keyspace != "ks" || b.LocalDC != "dc1" {
		t.Fatalf("%+v", b)
	}
	if _, err := b.TLSConfig(); err != nil {
		t.Fatal(err)
	}
}

func TestParseBundleErrors(t *testing.T) {
	p := makePKI(t)
	files := bundleFiles(p, "localhost", 443)
	delete(files, "key")
	data := makeZip(t, files)
	if _, err := ParseBundle(data, int64(len(data))); err == nil || !strings.Contains(err.Error(), "missing key") {
		t.Fatalf("err = %v", err)
	}
	if _, err := ParseBundle([]byte("nope"), 4); err == nil {
		t.Fatal("expected zip error")
	}
}

func TestFetchMetadata(t *testing.T) {
	p := makePKI(t)
	pair, _ := tls.X509KeyPair(p.certPEM, p.keyPEM)
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(p.caPEM)
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/metadata" || len(r.TLS.PeerCertificates) == 0 {
			http.Error(w, "no client cert", http.StatusForbidden)
			return
		}
		_ = json.NewEncoder(w).Encode(Metadata{Version: 1, Region: "r", ContactInfo: ContactInfo{
			TypeName: "sni_proxy", LocalDC: "dc1", SNIProxyAddress: "proxy:29042", ContactPoints: []string{"id-1", "id-2"},
		}})
	}))
	srv.TLS = &tls.Config{Certificates: []tls.Certificate{pair}, ClientCAs: pool, ClientAuth: tls.RequireAndVerifyClientCert}
	srv.StartTLS()
	defer srv.Close()
	_, portStr, _ := net.SplitHostPort(srv.Listener.Addr().String())
	port, _ := strconv.Atoi(portStr)
	data := makeZip(t, bundleFiles(p, "localhost", port))
	b, err := ParseBundle(data, int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	md, err := b.FetchMetadata(context.Background(), 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if md.ContactInfo.SNIProxyAddress != "proxy:29042" || len(md.ContactInfo.ContactPoints) != 2 || md.ContactInfo.LocalDC != "dc1" {
		t.Fatalf("%+v", md)
	}
}

func TestFetchMetadataRejectsWrongCA(t *testing.T) {
	good, other := makePKI(t), makePKI(t)
	pair, _ := tls.X509KeyPair(good.certPEM, good.keyPEM)
	srv := httptest.NewUnstartedServer(http.NotFoundHandler())
	srv.TLS = &tls.Config{Certificates: []tls.Certificate{pair}}
	srv.StartTLS()
	defer srv.Close()
	_, portStr, _ := net.SplitHostPort(srv.Listener.Addr().String())
	port, _ := strconv.Atoi(portStr)
	data := makeZip(t, bundleFiles(other, "localhost", port))
	b, err := ParseBundle(data, int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := b.FetchMetadata(context.Background(), 5*time.Second); err == nil {
		t.Fatal("expected certificate error")
	}
}
