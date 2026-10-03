package shell

import (
	"bytes"
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"os"
	"strconv"
	"strings"
	"text/template"
	"time"

	"github.com/0funct0ry/helenus/internal/cql"
)

// Clock and id sources are variables so tests can pin them.
var (
	nowFn      = time.Now
	uuidFn     = randomUUID
	timeuuidFn = func() string { return timeUUID(nowFn()) }
)

func formatUUID(b [16]byte) string {
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

// randomUUID returns a version 4 UUID.
func randomUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return formatUUID(b)
}

// timeUUID returns a version 1 UUID for t with a random node and clock sequence.
func timeUUID(t time.Time) string {
	// 100ns intervals since 1582-10-15.
	ts := uint64(t.UnixNano()/100) + 0x01b21dd213814000
	var b [16]byte
	binary.BigEndian.PutUint32(b[0:4], uint32(ts))
	binary.BigEndian.PutUint16(b[4:6], uint16(ts>>32))
	binary.BigEndian.PutUint16(b[6:8], uint16(ts>>48)&0x0fff|0x1000)
	_, _ = rand.Read(b[8:])
	b[8] = b[8]&0x3f | 0x80
	b[10] |= 0x01 // multicast bit marks a random node id
	return formatUUID(b)
}

// templateFuncs is the curated function set of SPEC §8.5. Nothing else is callable from an alias.
func templateFuncs(args []string) template.FuncMap {
	return template.FuncMap{
		"arg": func(n int) (string, error) {
			if n < 0 {
				return "", fmt.Errorf("arg: negative index %d", n)
			}
			if n >= len(args) {
				return "", nil // empty so `| default` can supply a value
			}
			return args[n], nil
		},
		"args": func() []string { return args },
		"default": func(def, v any) any {
			if s, ok := v.(string); ok && s == "" || v == nil {
				return def
			}
			return v
		},
		"quote": func(v any) string { return cql.QuoteString(fmt.Sprint(v)) },
		"ident": func(v any) string { return cql.QuoteIdent(fmt.Sprint(v)) },
		"now":   func() string { return nowFn().UTC().Format(time.RFC3339) },
		"today": func() string { return nowFn().UTC().Format("2006-01-02") },
		"ago": func(d string) (string, error) {
			dur, err := parseDuration(d)
			if err != nil {
				return "", err
			}
			return nowFn().Add(-dur).UTC().Format(time.RFC3339), nil
		},
		"uuid":     func() string { return uuidFn() },
		"timeuuid": func() string { return timeuuidFn() },
		"env":      os.Getenv,
		"upper":    strings.ToUpper,
		"lower":    strings.ToLower,
		"join":     func(sep string, parts []string) string { return strings.Join(parts, sep) },
		"split":    func(sep, s string) []string { return strings.Split(s, sep) },
	}
}

// parseDuration is time.ParseDuration plus a "d" (24h) and "w" suffix.
func parseDuration(s string) (time.Duration, error) {
	if n := len(s); n > 1 && (s[n-1] == 'd' || s[n-1] == 'w') {
		if v, err := strconv.ParseFloat(s[:n-1], 64); err == nil {
			unit := 24 * time.Hour
			if s[n-1] == 'w' {
				unit *= 7
			}
			return time.Duration(v * float64(unit)), nil
		}
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		return 0, fmt.Errorf("ago: bad duration %q", s)
	}
	return d, nil
}

// expandTemplate renders an alias body. Unknown variables are errors.
func expandTemplate(src string, data map[string]any, args []string) (string, error) {
	t, err := template.New("alias").Funcs(templateFuncs(args)).Option("missingkey=error").Parse(src)
	if err != nil {
		return "", fmt.Errorf("template: %w", err)
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("template: %w", err)
	}
	return buf.String(), nil
}
