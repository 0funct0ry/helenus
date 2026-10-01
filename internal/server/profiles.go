package server

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/astra"
	"github.com/0funct0ry/helenus/internal/config"
)

var nameRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

// maxBody bounds profile JSON bodies; maxBundle bounds secure connect bundles.
const (
	maxBody   = 1 << 20
	maxBundle = 8 << 20
)

// profileView is a profile as the API returns it: no secrets, plus live state.
type profileView struct {
	config.RedactedProfile
	Connected bool `json:"connected"`
}

func (a *api) view(p config.Profile) profileView {
	return profileView{RedactedProfile: p.Redacted(), Connected: a.conn.Connected(p.Name)}
}

func (a *api) listProfiles(c *gin.Context) {
	profiles, err := config.LoadProfiles(a.configPath)
	if err != nil {
		fail(c, http.StatusInternalServerError, "config_error", err.Error(), nil)
		return
	}
	out := make([]profileView, 0, len(profiles))
	for _, p := range profiles {
		out = append(out, a.view(p))
	}
	c.JSON(http.StatusOK, gin.H{"profiles": out})
}

// secretKeys are write-only: an empty or absent value leaves them unchanged.
var secretKeys = map[string]bool{"password": true, "astra.token": true}

// allowed lists the settable profile keys and the JSON kind each expects.
var allowed = map[string]string{
	"hosts": "list", "port": "int", "keyspace": "string", "consistency": "string",
	"serial_consistency": "string", "dc": "string", "username": "string",
	"password": "string", "password_command": "string",
	"tls.enabled": "bool", "tls.ca_cert": "string", "tls.cert": "string", "tls.key": "string",
	"tls.server_name": "string", "tls.insecure_skip_verify": "bool",
	"astra.secure_bundle": "string", "astra.token": "string", "astra.token_command": "string",
	"connect_timeout": "string", "request_timeout": "string", "protocol_version": "int",
}

// parseFields flattens a nested profile JSON body into dotted config keys.
// Empty non-secret values clear the key (nil); empty secrets are skipped so
// they stay unchanged. "clear_secrets" lists secrets to remove explicitly.
func parseFields(body map[string]any) (map[string]any, error) {
	flat := map[string]any{}
	var walk func(prefix string, m map[string]any) error
	walk = func(prefix string, m map[string]any) error {
		for k, v := range m {
			key := prefix + k
			if sub, ok := v.(map[string]any); ok && (k == "tls" || k == "astra") {
				if err := walk(key+".", sub); err != nil {
					return err
				}
				continue
			}
			if prefix == "" && (k == "name" || k == "clear_secrets") {
				continue
			}
			kind, ok := allowed[key]
			if !ok {
				return fmt.Errorf("unknown profile field %q", key)
			}
			val, err := coerce(key, kind, v)
			if err != nil {
				return err
			}
			if val == "" && secretKeys[key] {
				continue
			}
			flat[key] = val
		}
		return nil
	}
	if err := walk("", body); err != nil {
		return nil, err
	}
	if list, ok := body["clear_secrets"].([]any); ok {
		for _, s := range list {
			key, _ := s.(string)
			if key == "token" {
				key = "astra.token"
			}
			if !secretKeys[key] {
				return nil, fmt.Errorf("cannot clear %q", key)
			}
			flat[key] = nil
		}
	}
	return flat, nil
}

func coerce(key, kind string, v any) (any, error) {
	if v == nil {
		return nil, nil
	}
	bad := func() (any, error) { return nil, fmt.Errorf("field %q must be a %s", key, kind) }
	switch kind {
	case "string":
		s, ok := v.(string)
		if !ok {
			return bad()
		}
		if s == "" && !secretKeys[key] {
			return nil, nil
		}
		return s, nil
	case "bool":
		b, ok := v.(bool)
		if !ok {
			return bad()
		}
		return b, nil
	case "int":
		f, ok := v.(float64)
		if !ok || f != float64(int(f)) {
			return bad()
		}
		if f == 0 {
			return nil, nil
		}
		return int(f), nil
	case "list":
		raw, ok := v.([]any)
		if !ok {
			return bad()
		}
		var out []string
		for _, e := range raw {
			s, ok := e.(string)
			if !ok {
				return bad()
			}
			if s = strings.TrimSpace(s); s != "" {
				out = append(out, s)
			}
		}
		if len(out) == 0 {
			return nil, nil
		}
		return out, nil
	}
	return bad()
}

func readBody(c *gin.Context) (map[string]any, bool) {
	var body map[string]any
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBody)
	if err := c.ShouldBindJSON(&body); err != nil && !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "invalid_request", "request body must be a JSON object", nil)
		return nil, false
	}
	return body, true
}

func (a *api) createProfile(c *gin.Context) {
	body, ok := readBody(c)
	if !ok {
		return
	}
	name, _ := body["name"].(string)
	if !nameRE.MatchString(name) {
		fail(c, http.StatusBadRequest, "invalid_request", "name must be 1-64 letters, digits, '.', '_' or '-'", nil)
		return
	}
	fields, err := parseFields(body)
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid_request", err.Error(), nil)
		return
	}
	a.writeMu.Lock()
	err = config.Writer{Path: a.configPath}.AddProfile(name, nonNil(fields))
	a.writeMu.Unlock()
	if errors.Is(err, config.ErrProfileExists) {
		fail(c, http.StatusConflict, "profile_exists", err.Error(), nil)
		return
	}
	if err != nil {
		fail(c, http.StatusInternalServerError, "config_error", err.Error(), nil)
		return
	}
	a.respondProfile(c, http.StatusCreated, name)
}

func (a *api) updateProfile(c *gin.Context) {
	name := c.Param("name")
	body, ok := readBody(c)
	if !ok {
		return
	}
	fields, err := parseFields(body)
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid_request", err.Error(), nil)
		return
	}
	a.writeMu.Lock()
	err = config.Writer{Path: a.configPath}.UpdateProfile(name, fields)
	if err == nil {
		if to, _ := body["name"].(string); to != "" && to != name {
			if !nameRE.MatchString(to) {
				err = fmt.Errorf("invalid new name %q", to)
			} else if err = (config.Writer{Path: a.configPath}).RenameProfile(name, to); err == nil {
				a.conn.Disconnect(name)
				name = to
			}
		}
	}
	a.writeMu.Unlock()
	if a.writeError(c, err) {
		return
	}
	a.conn.Disconnect(name) // the next connect picks up the new settings
	a.respondProfile(c, http.StatusOK, name)
}

func (a *api) deleteProfile(c *gin.Context) {
	name := c.Param("name")
	a.writeMu.Lock()
	err := config.Writer{Path: a.configPath}.RemoveProfile(name)
	a.writeMu.Unlock()
	if a.writeError(c, err) {
		return
	}
	a.conn.Disconnect(name)
	c.Status(http.StatusNoContent)
}

func (a *api) writeError(c *gin.Context, err error) bool {
	var unknown *config.UnknownProfileError
	switch {
	case err == nil:
		return false
	case errors.As(err, &unknown):
		fail(c, http.StatusNotFound, "profile_not_found", err.Error(), nil)
	case errors.Is(err, config.ErrProfileExists):
		fail(c, http.StatusConflict, "profile_exists", err.Error(), nil)
	default:
		fail(c, http.StatusInternalServerError, "config_error", err.Error(), nil)
	}
	return true
}

func (a *api) respondProfile(c *gin.Context, status int, name string) {
	p, err := config.LoadProfile(a.configPath, name)
	if err != nil {
		fail(c, http.StatusInternalServerError, "config_error", err.Error(), nil)
		return
	}
	c.JSON(status, a.view(p))
}

func nonNil(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

func (a *api) testSaved(c *gin.Context) {
	name := c.Param("name")
	base, err := config.LoadProfile(a.configPath, name)
	var unknown *config.UnknownProfileError
	if errors.As(err, &unknown) {
		fail(c, http.StatusNotFound, "profile_not_found", err.Error(), nil)
		return
	}
	if err != nil {
		fail(c, http.StatusInternalServerError, "config_error", err.Error(), nil)
		return
	}
	body, ok := readBody(c)
	if !ok {
		return
	}
	a.runTest(c, base, body)
}

func (a *api) testUnsaved(c *gin.Context) {
	body, ok := readBody(c)
	if !ok {
		return
	}
	base := config.Profile{}
	// An unsaved edit of an existing profile may omit secrets: fall back to the saved ones.
	if name, _ := body["name"].(string); name != "" {
		if saved, err := config.LoadProfile(a.configPath, name); err == nil {
			base = saved
		}
	}
	a.runTest(c, base, body)
}

func (a *api) runTest(c *gin.Context, base config.Profile, body map[string]any) {
	fields, err := parseFields(body)
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid_request", err.Error(), nil)
		return
	}
	p, err := config.ApplyFields(base, fields)
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid_request", err.Error(), nil)
		return
	}
	c.JSON(http.StatusOK, a.conn.Test(c.Request.Context(), p))
}

func (a *api) uploadBundle(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBundle+1<<16)
	fh, err := c.FormFile("bundle")
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid_request", "multipart field \"bundle\" is required", nil)
		return
	}
	if fh.Size > maxBundle {
		fail(c, http.StatusRequestEntityTooLarge, "too_large", "secure connect bundle is larger than 8 MB", nil)
		return
	}
	f, err := fh.Open()
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid_request", err.Error(), nil)
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxBundle+1))
	if err != nil || len(data) > maxBundle {
		fail(c, http.StatusBadRequest, "invalid_request", "could not read the upload", nil)
		return
	}
	b, err := astra.ParseBundle(data, int64(len(data)))
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid_bundle", err.Error(), nil)
		return
	}
	stem := strings.TrimSuffix(filepath.Base(fh.Filename), filepath.Ext(fh.Filename))
	stem = regexp.MustCompile(`[^A-Za-z0-9._-]`).ReplaceAllString(stem, "_")
	if stem == "" || stem == "." || stem == ".." {
		stem = "bundle"
	}
	dir := filepath.Join(a.dataDir, "bundles")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		fail(c, http.StatusInternalServerError, "storage_error", err.Error(), nil)
		return
	}
	path := filepath.Join(dir, stem+".zip")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		fail(c, http.StatusInternalServerError, "storage_error", err.Error(), nil)
		return
	}
	c.JSON(http.StatusOK, gin.H{"path": path, "host": b.Host, "keyspace": b.Keyspace, "local_dc": b.LocalDC})
}
