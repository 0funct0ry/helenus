package server

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
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
	"github.com/0funct0ry/helenus/internal/dataio/detect"
	"github.com/0funct0ry/helenus/internal/dataio/importer"
	"github.com/0funct0ry/helenus/internal/jobs"
	"github.com/0funct0ry/helenus/internal/schema"
)

const (
	defaultMaxUpload   = 1 << 30
	importFileTTL      = time.Hour
	importPreviewRows  = 20
	importDryRunRows   = 100
	importDryRunErrors = 200
)

// importUpload is one uploaded file waiting for an import.
type importUpload struct {
	Path    string
	Name    string
	Size    int64
	Profile string
}

// importUploads maps upload ids to temp files and finished job ids to their error files.
type importUploads struct {
	mu     sync.Mutex
	files  map[string]importUpload
	errors map[string]string
}

func (u *importUploads) put(id string, up importUpload) {
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.files == nil {
		u.files = map[string]importUpload{}
	}
	u.files[id] = up
}

func (u *importUploads) get(id string) (importUpload, bool) {
	u.mu.Lock()
	defer u.mu.Unlock()
	up, ok := u.files[id]
	return up, ok
}

func (u *importUploads) setErrors(job, path string) {
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.errors == nil {
		u.errors = map[string]string{}
	}
	u.errors[job] = path
}

func (u *importUploads) errorsFile(job string) (string, bool) {
	u.mu.Lock()
	defer u.mu.Unlock()
	p, ok := u.errors[job]
	return p, ok
}

func (a *api) importDir() string { return filepath.Join(a.dataDir, "imports") }

// sweepImports deletes uploads and error reports older than the TTL.
func (a *api) sweepImports() {
	entries, err := os.ReadDir(a.importDir())
	if err != nil {
		return
	}
	for _, e := range entries {
		info, err := e.Info()
		if err != nil || time.Since(info.ModTime()) <= importFileTTL {
			continue
		}
		path := filepath.Join(a.importDir(), e.Name())
		_ = os.Remove(path)
		a.uploads.mu.Lock()
		for id, up := range a.uploads.files {
			if up.Path == path {
				delete(a.uploads.files, id)
			}
		}
		for id, p := range a.uploads.errors {
			if p == path {
				delete(a.uploads.errors, id)
			}
		}
		a.uploads.mu.Unlock()
	}
}

func randomID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// importUploadHandler stores the multipart "file" part in the data dir and detects its format.
func (a *api) importUploadHandler(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok {
		return
	}
	limit := a.maxUpload
	if limit <= 0 {
		limit = defaultMaxUpload
	}
	a.sweepImports()
	if err := os.MkdirAll(a.importDir(), 0o700); err != nil {
		fail(c, http.StatusInternalServerError, "upload_failed", err.Error(), nil)
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit+(1<<20))
	mr, err := c.Request.MultipartReader()
	if err != nil {
		fail(c, http.StatusBadRequest, "bad_request", "expected a multipart upload with a file part", nil)
		return
	}
	for {
		part, err := mr.NextPart()
		if err != nil {
			fail(c, http.StatusBadRequest, "bad_request", "the upload has no \"file\" part", nil)
			return
		}
		if part.FormName() != "file" {
			continue
		}
		id := randomID()
		path := filepath.Join(a.importDir(), id+".upload")
		f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o600)
		if err != nil {
			fail(c, http.StatusInternalServerError, "upload_failed", err.Error(), nil)
			return
		}
		n, err := io.Copy(f, io.LimitReader(part, limit+1))
		_ = f.Close()
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) || n > limit {
			_ = os.Remove(path)
			fail(c, http.StatusRequestEntityTooLarge, "too_large", "the file is larger than the upload limit ("+humanBytes(limit)+"); raise it with --max-upload", nil)
			return
		}
		if err != nil {
			_ = os.Remove(path)
			fail(c, http.StatusBadRequest, "upload_failed", err.Error(), nil)
			return
		}
		name := filepath.Base(part.FileName())
		a.uploads.put(id, importUpload{Path: path, Name: name, Size: n, Profile: p.Name})
		head := make([]byte, detect.SniffSize)
		hf, _ := os.Open(path)
		hn, _ := io.ReadFull(hf, head)
		_ = hf.Close()
		c.JSON(http.StatusCreated, gin.H{"upload": id, "name": name, "size": n, "detect": detect.Detect(name, head[:hn])})
		return
	}
}

func humanBytes(n int64) string {
	switch {
	case n >= 1<<30:
		return strconv.FormatInt(n>>30, 10) + " GB"
	case n >= 1<<20:
		return strconv.FormatInt(n>>20, 10) + " MB"
	}
	return strconv.FormatInt(n, 10) + " bytes"
}

// importRequest is the body of plan, dry-run and run.
type importRequest struct {
	Upload string `json:"upload"`
	Table  struct {
		Keyspace string `json:"keyspace"`
		Table    string `json:"table"`
	} `json:"table"`
	Format  importer.Format     `json:"format"`
	Mapping *[]importer.Mapping `json:"mapping"`
	Options importer.Options    `json:"options"`
	Rows    int                 `json:"rows"`
}

// importCtx is a validated request with its file open for reading.
type importCtx struct {
	p      config.Profile
	up     importUpload
	table  schema.Table
	job    importer.Job
	format importer.Format
	rd     *importer.Reader
	file   *os.File
	auto   map[string]string // target -> confidence of the automatic mapping
}

func (ic *importCtx) close() { _ = ic.file.Close() }

// prepareImport resolves the upload, table, format and mapping and opens the reader.
func (a *api) prepareImport(c *gin.Context, in *importRequest) (*importCtx, bool) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return nil, false
	}
	up, found := a.uploads.get(in.Upload)
	if !found || up.Profile != p.Name {
		fail(c, http.StatusNotFound, "upload_not_found", "the upload expired or does not exist; upload the file again", nil)
		return nil, false
	}
	snap, t, ok := a.writableTable(c, p, in.Table.Keyspace, in.Table.Table, "imported into", "import into")
	if !ok {
		return nil, false
	}
	f, err := os.Open(up.Path)
	if err != nil {
		fail(c, http.StatusNotFound, "upload_not_found", "the upload expired; upload the file again", nil)
		return nil, false
	}
	format := in.Format
	if format.Kind == "" {
		head := make([]byte, detect.SniffSize)
		n, _ := io.ReadFull(f, head)
		d := detect.Detect(up.Name, head[:n])
		_, _ = f.Seek(0, io.SeekStart)
		format = importer.Format{Kind: d.Format, Delimiter: d.Delimiter, Quote: d.Quote, Header: d.Header}
	}
	if format.Kind == detect.CSV && format.Delimiter == "" {
		format.Delimiter = ","
	}
	rd, err := importer.Open(f, format)
	if err != nil {
		_ = f.Close()
		fail(c, http.StatusUnprocessableEntity, "unreadable_file", err.Error(), nil)
		return nil, false
	}
	ic := &importCtx{p: p, up: up, table: t, format: format, rd: rd, file: f, auto: map[string]string{}}
	var mapping []importer.Mapping
	if in.Mapping != nil {
		mapping = *in.Mapping
		for _, m := range mapping {
			if m.Source != "" {
				ic.auto[m.Target] = detect.Label(m.Source, m.Target)
			}
		}
	} else {
		targets := make([]string, len(t.Columns))
		for i, col := range t.Columns {
			targets[i] = col.Name
		}
		got := map[string]detect.Match{}
		for _, m := range detect.Auto(rd.Columns(), targets) {
			got[m.Target] = m
		}
		for _, tn := range targets {
			m := got[tn]
			mapping = append(mapping, importer.Mapping{Target: tn, Source: m.Source})
			if m.Source != "" {
				ic.auto[tn] = m.Confidence
			}
		}
	}
	ic.job = importer.Job{Table: t, UDT: snap.UDTFields, Mapping: mapping, Opts: in.Options}
	return ic, true
}

// importPlan reports detection, mapping and per-column type checks without writing.
func (a *api) importPlan(c *gin.Context) {
	var in importRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	ic, ok := a.prepareImport(c, &in)
	if !ok {
		return
	}
	defer ic.close()
	errs := []string{}
	if ic.table.Counter {
		errs = append(errs, "Counter tables cannot be imported.")
	}
	for _, k := range ic.job.MissingKeys() {
		errs = append(errs, "Map a source column to "+k)
	}
	if _, err := ic.job.Opts.Normalized(); err != nil {
		errs = append(errs, err.Error())
	}
	checks, n, err := ic.job.Check(ic.rd.Peeked())
	if err != nil {
		errs = append(errs, err.Error())
	}
	byTarget := map[string]importer.ColumnCheck{}
	for _, ck := range checks {
		byTarget[ck.Target] = ck
	}
	type colOut struct {
		Target     string              `json:"target"`
		Type       string              `json:"type"`
		Kind       string              `json:"kind"`
		Source     string              `json:"source"`
		Confidence string              `json:"confidence"`
		Failures   int                 `json:"failures"`
		Samples    []importer.RowError `json:"samples"`
	}
	srcOf := map[string]string{}
	for _, m := range ic.job.Mapping {
		srcOf[m.Target] = m.Source
	}
	cols := make([]colOut, len(ic.table.Columns))
	for i, col := range ic.table.Columns {
		ck := byTarget[col.Name]
		if ck.Samples == nil {
			ck.Samples = []importer.RowError{}
		}
		cols[i] = colOut{Target: col.Name, Type: col.CQL, Kind: col.Kind, Source: srcOf[col.Name], Confidence: ic.auto[col.Name],
			Failures: ck.Failures, Samples: ck.Samples}
	}
	preview := [][]string{}
	src := ic.rd.Columns()
	for i, rec := range ic.rd.Peeked() {
		if i >= importPreviewRows {
			break
		}
		if ic.format.Kind == detect.CSV {
			preview = append(preview, rec.Raw)
			continue
		}
		row := make([]string, len(src))
		for k, name := range src {
			row[k] = importer.Text(rec.Vals[name])
		}
		preview = append(preview, row)
	}
	c.JSON(http.StatusOK, gin.H{"format": ic.format, "size": ic.up.Size, "source_columns": src, "preview": preview,
		"columns": cols, "errors": errs, "rows_checked": n})
}

// importDryRun parses and validates the first rows and writes nothing.
func (a *api) importDryRun(c *gin.Context) {
	var in importRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	ic, ok := a.prepareImport(c, &in)
	if !ok {
		return
	}
	defer ic.close()
	if err := ic.job.Validate(); err != nil {
		fail(c, http.StatusUnprocessableEntity, "invalid_import", err.Error(), nil)
		return
	}
	n := in.Rows
	if n <= 0 {
		n = importDryRunRows
	}
	valid, total, errs, err := ic.job.DryRun(ic.rd, n)
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, "unreadable_file", err.Error(), nil)
		return
	}
	truncated := len(errs) > importDryRunErrors
	if truncated {
		errs = errs[:importDryRunErrors]
	}
	for i := range errs {
		errs[i].Record = nil
	}
	if errs == nil {
		errs = []importer.RowError{}
	}
	c.JSON(http.StatusOK, gin.H{"rows": total, "valid": valid, "invalid": total - valid, "errors": errs, "truncated": truncated})
}

// countRecords estimates the record count of a line-oriented file for progress.
func countRecords(path string, format importer.Format) int64 {
	if format.Kind == detect.JSON {
		return 0
	}
	f, err := os.Open(path)
	if err != nil {
		return 0
	}
	defer f.Close()
	buf := make([]byte, 1<<20)
	var n int64
	var last byte = '\n'
	for {
		k, err := f.Read(buf)
		n += int64(bytes.Count(buf[:k], []byte{'\n'}))
		if k > 0 {
			last = buf[k-1]
		}
		if err != nil {
			break
		}
	}
	if last != '\n' {
		n++
	}
	if format.Kind == detect.CSV && format.Header && n > 0 {
		n--
	}
	return n
}

// importRun starts the import as a background job.
func (a *api) importRun(c *gin.Context) {
	var in importRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	ic, ok := a.prepareImport(c, &in)
	if !ok {
		return
	}
	ic.close()
	opts, err := ic.job.Opts.Normalized()
	if err == nil {
		ic.job.Opts = opts
		err = ic.job.Validate()
	}
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, "invalid_import", err.Error(), nil)
		return
	}
	ex := connExec{a: a, name: ic.p.Name, p: ic.p}
	job := a.jobs.Start("import", ic.p.Name, func(ctx context.Context, rep *jobs.Reporter) error {
		f, err := os.Open(ic.up.Path)
		if err != nil {
			return err
		}
		defer f.Close()
		rd, err := importer.Open(f, ic.format)
		if err != nil {
			return err
		}
		errPath := filepath.Join(a.importDir(), rep.ID()+".errors.csv")
		ef, err := os.OpenFile(errPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
		if err != nil {
			return err
		}
		total := countRecords(ic.up.Path, ic.format)
		rep.Update(0, total, 0)
		res, runErr := ic.job.Run(ctx, ex, rd, ef, total, rep.Update)
		_ = ef.Close()
		if res.Rejected > 0 {
			a.uploads.setErrors(rep.ID(), errPath)
		} else {
			_ = os.Remove(errPath)
		}
		rep.SetResult(res)
		return runErr
	})
	c.JSON(http.StatusAccepted, gin.H{"id": job.ID, "job": job})
}

// importErrors downloads the error report of a finished import.
func (a *api) importErrors(c *gin.Context) {
	if _, ok := a.profileOr404(c); !ok {
		return
	}
	path, ok := a.uploads.errorsFile(c.Param("job"))
	if !ok {
		fail(c, http.StatusNotFound, "no_error_report", "this import has no error report (no rows were rejected, or it expired)", nil)
		return
	}
	c.Header("Content-Disposition", `attachment; filename="`+strings.TrimSuffix(c.Param("job"), ".csv")+`-errors.csv"`)
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.File(path)
}
