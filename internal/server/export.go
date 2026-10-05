package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/config"
	"github.com/0funct0ry/helenus/internal/dataio/export"
	"github.com/0funct0ry/helenus/internal/exec"
	"github.com/0funct0ry/helenus/internal/jobs"
	"github.com/0funct0ry/helenus/internal/schema"
	"github.com/0funct0ry/helenus/internal/store"
)

// exportFileTTL is how long a finished export waits for its download.
const exportFileTTL = time.Hour

// exportFiles maps finished export job ids to their temp files.
type exportFiles struct {
	mu    sync.Mutex
	paths map[string]string
}

func (f *exportFiles) set(id, path string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.paths == nil {
		f.paths = map[string]string{}
	}
	f.paths[id] = path
}

func (f *exportFiles) take(id string) (string, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.paths[id]
	delete(f.paths, id)
	return p, ok
}

type exportRequest struct {
	Source struct {
		Table *struct {
			Keyspace string   `json:"keyspace"`
			Table    string   `json:"table"`
			Columns  []string `json:"columns"`
			Where    string   `json:"where"`
		} `json:"table"`
		Query string `json:"query"`
	} `json:"source"`
	Format        string         `json:"format"`
	Options       export.Options `json:"options"`
	Filename      string         `json:"filename"`
	Consistency   string         `json:"consistency"`
	PageSize      int            `json:"page_size"`
	RowsPerSecond int            `json:"rows_per_second"`
	Ranges        int            `json:"ranges"`
	Concurrency   int            `json:"concurrency"`
}

// connRunner adapts the Connector to export.Runner.
type connRunner struct {
	a    *api
	name string
	p    config.Profile
}

func (r connRunner) Run(ctx context.Context, req exec.Request) (*exec.Result, error) {
	return r.a.conn.Query(ctx, r.name, r.p, req)
}

func (a *api) exportDir() string { return filepath.Join(a.dataDir, "exports") }

// sweepExports deletes export files older than the TTL.
func (a *api) sweepExports() {
	entries, err := os.ReadDir(a.exportDir())
	if err != nil {
		return
	}
	for _, e := range entries {
		if info, err := e.Info(); err == nil && time.Since(info.ModTime()) > exportFileTTL {
			_ = os.Remove(filepath.Join(a.exportDir(), e.Name()))
		}
	}
}

// exportFilename returns a safe download name, defaulting to <table>-<yyyyMMdd-HHmm>.<ext>.
func exportFilename(name, table, ext string, now time.Time) string {
	name = filepath.Base(strings.TrimSpace(name))
	if name == "." || name == string(filepath.Separator) || name == "" {
		base := table
		if base == "" {
			base = "query"
		}
		return base + "-" + now.Format("20060102-1504") + "." + ext
	}
	name = strings.Map(func(r rune) rune {
		if r < 32 || strings.ContainsRune(`"\/:*?<>|`, r) {
			return '_'
		}
		return r
	}, name)
	if filepath.Ext(name) == "" {
		name += "." + ext
	}
	return name
}

func (a *api) exportStart(c *gin.Context) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return
	}
	var in exportRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	ext, known := export.Formats[in.Format]
	if !known {
		fail(c, http.StatusBadRequest, "bad_request", "unknown export format "+in.Format, nil)
		return
	}
	if err := in.Options.Validate(in.Format); err != nil {
		fail(c, http.StatusUnprocessableEntity, "invalid_options", err.Error(), nil)
		return
	}
	if in.Ranges < 0 || in.Ranges > export.MaxRanges || in.RowsPerSecond < 0 {
		fail(c, http.StatusUnprocessableEntity, "invalid_options", "ranges must be 0–64 and rows_per_second not negative", nil)
		return
	}
	snap, err := a.conn.Schema(c.Request.Context(), p.Name, p, false)
	if err != nil {
		fail(c, http.StatusBadGateway, "schema_failed", err.Error(), nil)
		return
	}
	var src export.Source
	tableName := ""
	switch t := in.Source.Table; {
	case t != nil:
		ks := snap.Keyspace(t.Keyspace)
		var cols []schema.Column
		if ks != nil {
			if tb := ks.Table(t.Table); tb != nil {
				cols = tb.Columns
			} else if v := ks.View(t.Table); v != nil {
				cols = v.Columns
			}
		}
		if cols == nil {
			fail(c, http.StatusNotFound, "table_not_found", "table "+t.Keyspace+"."+t.Table+" not found", nil)
			return
		}
		known := map[string]bool{}
		for _, col := range cols {
			known[col.Name] = true
			if col.Kind == schema.KindPartition {
				src.PartitionKey = append(src.PartitionKey, col.Name)
			}
		}
		for _, name := range t.Columns {
			if !known[name] {
				fail(c, http.StatusUnprocessableEntity, "unknown_column", "column "+name+" does not exist", nil)
				return
			}
		}
		src.Keyspace, src.Table, src.Columns, src.Where = t.Keyspace, t.Table, t.Columns, t.Where
		tableName = t.Table
		if in.Options.Table == "" {
			in.Options.Table = t.Keyspace + "." + t.Table
		}
	case strings.TrimSpace(in.Source.Query) != "":
		q := strings.TrimSpace(in.Source.Query)
		if f := strings.Fields(q); len(f) == 0 || !strings.EqualFold(f[0], "select") {
			fail(c, http.StatusUnprocessableEntity, "invalid_source", "only SELECT statements can be exported", nil)
			return
		}
		src.Query = q
	default:
		fail(c, http.StatusBadRequest, "bad_request", "source needs a table or a query", nil)
		return
	}
	if in.Ranges > 1 && (src.Query != "" || strings.TrimSpace(src.Where) != "") {
		fail(c, http.StatusUnprocessableEntity, "invalid_options", "token-range split applies to whole tables only", nil)
		return
	}
	// Validate the statement (and WHERE) by running one row of it.
	run := connRunner{a: a, name: p.Name, p: p}
	probe, err := run.Run(c.Request.Context(), exec.Request{CQL: src.Statement(), PageSize: 1, Consistency: in.Consistency})
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, "invalid_source", err.Error(), nil)
		return
	}
	if probe.Kind != exec.KindRows {
		fail(c, http.StatusUnprocessableEntity, "invalid_source", "the statement returns no rows", nil)
		return
	}

	if err := os.MkdirAll(a.exportDir(), 0o700); err != nil {
		fail(c, http.StatusInternalServerError, "export_failed", err.Error(), nil)
		return
	}
	a.sweepExports()
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	path := filepath.Join(a.exportDir(), hex.EncodeToString(b)+"."+ext)
	filename := exportFilename(in.Filename, tableName, ext, time.Now())
	cfg := export.Config{PageSize: in.PageSize, Consistency: in.Consistency, RowsPerSecond: in.RowsPerSecond,
		Ranges: in.Ranges, Concurrency: in.Concurrency}

	job := a.jobs.Start("export", p.Name, func(ctx context.Context, rep *jobs.Reporter) (err error) {
		f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o600)
		if err != nil {
			return err
		}
		defer func() {
			if cerr := f.Close(); err == nil {
				err = cerr
			}
			if err != nil || ctx.Err() != nil {
				_ = os.Remove(path)
			}
		}()
		w, err := export.NewWriter(in.Format, f, in.Options, snap.UDTFields)
		if err != nil {
			return err
		}
		cfg.Progress = func(n int64) { rep.Update(n, 0, 0) }
		n, err := export.Run(ctx, run, src, cfg, w)
		if err != nil {
			return err
		}
		var size int64
		if st, serr := f.Stat(); serr == nil {
			size = st.Size()
		}
		rep.Update(n, n, 0)
		rep.SetResult(gin.H{"filename": filename, "rows": n, "bytes": size, "format": in.Format})
		a.exports.set(rep.ID(), path)
		return nil
	})
	c.JSON(http.StatusAccepted, gin.H{"id": job.ID, "job": job, "filename": filename})
}

func (a *api) exportFile(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok {
		return
	}
	id := c.Param("job")
	j, found := a.jobs.Get(p.Name, id)
	if !found || j.Kind != "export" {
		fail(c, http.StatusNotFound, "job_not_found", "export not found (exports are lost when helenus restarts)", nil)
		return
	}
	if j.State != jobs.Done {
		fail(c, http.StatusConflict, "export_not_ready", "the export is "+j.State, nil)
		return
	}
	path, ok := a.exports.take(id)
	if !ok {
		fail(c, http.StatusGone, "export_gone", "the file was already downloaded or expired", nil)
		return
	}
	f, err := os.Open(path)
	if err != nil {
		fail(c, http.StatusGone, "export_gone", "the file was already downloaded or expired", nil)
		return
	}
	defer func() { _ = f.Close(); _ = os.Remove(path) }()
	name := "export"
	if m, ok := j.Result.(gin.H); ok {
		name, _ = m["filename"].(string)
	}
	c.Header("Content-Disposition", `attachment; filename="`+strings.ReplaceAll(name, `"`, "_")+`"`)
	c.Header("Content-Type", "application/octet-stream")
	c.Status(http.StatusOK)
	_, _ = io.Copy(c.Writer, f)
}

// exportPresetBody is the body of preset create and update.
type exportPresetBody struct {
	Name    string          `json:"name"`
	Format  string          `json:"format"`
	Options json.RawMessage `json:"options"`
	Columns []string        `json:"columns"`
	// Global stores the preset for all profiles.
	Global bool `json:"global"`
}

type exportPresetJSON struct {
	store.ExportPreset
	Options json.RawMessage `json:"options"`
}

func presetJSON(p store.ExportPreset) exportPresetJSON {
	return exportPresetJSON{ExportPreset: p, Options: json.RawMessage(p.Options)}
}

func (a *api) presetBody(c *gin.Context) (exportPresetBody, bool) {
	var in exportPresetBody
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return in, false
	}
	in.Name = strings.TrimSpace(in.Name)
	if len(in.Options) == 0 {
		in.Options = json.RawMessage("{}")
	}
	if _, known := export.Formats[in.Format]; in.Name == "" || !known || !json.Valid(in.Options) {
		fail(c, http.StatusBadRequest, "bad_request", "name, a known format and valid options are required", nil)
		return in, false
	}
	return in, true
}

func (a *api) presetFail(c *gin.Context, err error, name string) {
	switch {
	case errors.Is(err, store.ErrExportPresetExists):
		fail(c, http.StatusConflict, "export_preset_exists", "a preset named "+name+" already exists", nil)
	case errors.Is(err, store.ErrExportPresetNotFound):
		fail(c, http.StatusNotFound, "export_preset_not_found", "export preset not found", nil)
	default:
		fail(c, http.StatusInternalServerError, "store_failed", err.Error(), nil)
	}
}

func (a *api) exportPresetsList(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok || !a.seedStore(c) {
		return
	}
	items, err := a.store.ListExportPresets(p.Name)
	if err != nil {
		a.presetFail(c, err, "")
		return
	}
	out := make([]exportPresetJSON, len(items))
	for i, it := range items {
		out[i] = presetJSON(it)
	}
	c.JSON(http.StatusOK, gin.H{"presets": out})
}

func (a *api) exportPresetsCreate(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok || !a.seedStore(c) {
		return
	}
	in, ok := a.presetBody(c)
	if !ok {
		return
	}
	pr := store.ExportPreset{Name: in.Name, Format: in.Format, Options: string(in.Options), Columns: in.Columns}
	if !in.Global {
		pr.Profile = p.Name
	}
	saved, err := a.store.CreateExportPreset(pr)
	if err != nil {
		a.presetFail(c, err, in.Name)
		return
	}
	c.JSON(http.StatusCreated, presetJSON(saved))
}

func (a *api) exportPresetsUpdate(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok || !a.seedStore(c) {
		return
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	in, ok := a.presetBody(c)
	if !ok {
		return
	}
	saved, err := a.store.UpdateExportPreset(p.Name, id, store.ExportPreset{Name: in.Name, Format: in.Format,
		Options: string(in.Options), Columns: in.Columns})
	if err != nil {
		a.presetFail(c, err, in.Name)
		return
	}
	c.JSON(http.StatusOK, presetJSON(saved))
}

func (a *api) exportPresetsDelete(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok || !a.seedStore(c) {
		return
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	deleted, err := a.store.DeleteExportPreset(p.Name, id)
	switch {
	case err != nil:
		a.presetFail(c, err, "")
	case !deleted:
		a.presetFail(c, store.ErrExportPresetNotFound, "")
	default:
		c.Status(http.StatusNoContent)
	}
}
