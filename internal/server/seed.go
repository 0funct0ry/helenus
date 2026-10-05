package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/config"
	"github.com/0funct0ry/helenus/internal/exec"
	"github.com/0funct0ry/helenus/internal/jobs"
	"github.com/0funct0ry/helenus/internal/schema"
	seedgen "github.com/0funct0ry/helenus/internal/seed"
	"github.com/0funct0ry/helenus/internal/store"
)

const seedPreviewRows = 20

// seedRequest is the body of seed preview and run.
type seedRequest struct {
	Table struct {
		Keyspace string `json:"keyspace"`
		Table    string `json:"table"`
	} `json:"table"`
	Config seedgen.Config `json:"config"`
}

// seedTarget resolves the request's table; views and system keyspaces are refused.
func (a *api) seedTarget(c *gin.Context, p config.Profile, ksName, name string) (*schema.Snapshot, schema.Table, bool) {
	snap, err := a.conn.Schema(c.Request.Context(), p.Name, p, false)
	if err != nil {
		fail(c, http.StatusBadGateway, "schema_failed", err.Error(), nil)
		return nil, schema.Table{}, false
	}
	ks := snap.Keyspace(ksName)
	if ks == nil {
		fail(c, http.StatusNotFound, "keyspace_not_found", "keyspace "+ksName+" not found", nil)
		return nil, schema.Table{}, false
	}
	if ks.System {
		fail(c, http.StatusUnprocessableEntity, "read_only", "system keyspaces are read-only", nil)
		return nil, schema.Table{}, false
	}
	t := ks.Table(name)
	if t == nil {
		for _, v := range ks.Views {
			if v.Name == name {
				fail(c, http.StatusUnprocessableEntity, "read_only", "materialized views cannot be seeded; seed the base table", nil)
				return nil, schema.Table{}, false
			}
		}
		fail(c, http.StatusNotFound, "table_not_found", "table "+name+" not found in "+ks.Name, nil)
		return nil, schema.Table{}, false
	}
	return snap, *t, true
}

// seedPreview validates a configuration and returns the defaults-filled config,
// the first rows and a sample statement. Problems come back as errors[] with
// HTTP 200, like the other planners.
func (a *api) seedPreview(c *gin.Context) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return
	}
	var in seedRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	snap, t, ok := a.seedTarget(c, p, in.Table.Keyspace, in.Table.Table)
	if !ok {
		return
	}
	now := seedgen.Now()
	cfg, notes := seedgen.Normalize(t, in.Config, now)
	out := gin.H{"config": cfg, "columns": seedgen.Columns(t), "notes": notes, "errors": []seedgen.FieldError{},
		"rows": [][]any{}, "statement": "", "counter": t.Counter}
	plan, errs := seedgen.NewPlan(t, snap, cfg, now)
	if plan == nil {
		out["errors"] = errs
		c.JSON(http.StatusOK, out)
		return
	}
	rows := plan.Rows(seedPreviewRows)
	out["rows"] = rows
	out["partitions"] = plan.Partitions()
	if len(rows) > 0 {
		out["statement"] = plan.Sample(rows[0])
	}
	if plan.Skipped > 0 {
		notes = append(notes, "Some preview rows were skipped because generated keys collided; use a wider key generator.")
		out["notes"] = notes
	}
	c.JSON(http.StatusOK, out)
}

// connExec adapts the Connector to seedgen.Executor.
type connExec struct {
	a    *api
	name string
	p    config.Profile
}

func (e connExec) Exec(ctx context.Context, cql string, args []any, cons string) error {
	_, err := e.a.conn.Query(ctx, e.name, e.p, exec.Request{CQL: cql, Args: args, Consistency: cons})
	return err
}

// seedRun starts the seed as a background job.
func (a *api) seedRun(c *gin.Context) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return
	}
	var in seedRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	snap, t, ok := a.seedTarget(c, p, in.Table.Keyspace, in.Table.Table)
	if !ok {
		return
	}
	plan, errs := seedgen.NewPlan(t, snap, in.Config, seedgen.Now())
	if plan == nil {
		fail(c, http.StatusUnprocessableEntity, "invalid_config", "the seed configuration has errors", gin.H{"errors": errs})
		return
	}
	ex := connExec{a: a, name: p.Name, p: p}
	job := a.jobs.Start("seed", p.Name, func(ctx context.Context, rep *jobs.Reporter) error {
		rep.Update(0, int64(plan.Cfg.TotalRows), 0)
		return plan.Run(ctx, ex, rep)
	})
	c.JSON(http.StatusAccepted, gin.H{"id": job.ID, "job": job})
}

func (a *api) jobsList(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"jobs": a.jobs.List(p.Name)})
}

func (a *api) jobsGet(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok {
		return
	}
	j, found := a.jobs.Get(p.Name, c.Param("id"))
	if !found {
		fail(c, http.StatusNotFound, "job_not_found", "job not found (jobs are lost when helenus restarts)", nil)
		return
	}
	c.JSON(http.StatusOK, j)
}

func (a *api) jobsCancel(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok {
		return
	}
	if !a.jobs.Cancel(p.Name, c.Param("id")) {
		fail(c, http.StatusNotFound, "job_not_found", "job not found", nil)
		return
	}
	j, _ := a.jobs.Get(p.Name, c.Param("id"))
	c.JSON(http.StatusAccepted, j)
}

// seedProfileJSON is one saved profile with its parsed configuration.
type seedProfileJSON struct {
	store.SeedProfile
	Config json.RawMessage `json:"config"`
}

func profileJSON(p store.SeedProfile) seedProfileJSON {
	return seedProfileJSON{SeedProfile: p, Config: json.RawMessage(p.Config)}
}

func (a *api) seedStore(c *gin.Context) bool {
	if a.store == nil {
		fail(c, http.StatusServiceUnavailable, "store_unavailable", "the local database is not available", nil)
		return false
	}
	return true
}

func (a *api) seedProfilesList(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok || !a.seedStore(c) {
		return
	}
	items, err := a.store.ListSeedProfiles(p.Name, c.Query("keyspace"), c.Query("table"))
	if err != nil {
		fail(c, http.StatusInternalServerError, "store_failed", err.Error(), nil)
		return
	}
	out := make([]seedProfileJSON, len(items))
	for i, it := range items {
		out[i] = profileJSON(it)
	}
	c.JSON(http.StatusOK, gin.H{"profiles": out})
}

type seedProfileBody struct {
	Keyspace  string          `json:"keyspace"`
	Table     string          `json:"table"`
	Name      string          `json:"name"`
	Config    json.RawMessage `json:"config"`
	Overwrite bool            `json:"overwrite"`
}

func (a *api) seedProfilesSave(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok || !a.seedStore(c) {
		return
	}
	var in seedProfileBody
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || in.Keyspace == "" || in.Table == "" || len(in.Config) == 0 || !json.Valid(in.Config) {
		fail(c, http.StatusBadRequest, "bad_request", "keyspace, table, name and config are required", nil)
		return
	}
	saved, err := a.store.SaveSeedProfile(store.SeedProfile{Profile: p.Name, Keyspace: in.Keyspace, Table: in.Table,
		Name: in.Name, Config: string(in.Config)}, in.Overwrite)
	if errors.Is(err, store.ErrSeedProfileExists) {
		fail(c, http.StatusConflict, "seed_profile_exists", "a seed profile named "+in.Name+" already exists for this table", nil)
		return
	}
	if err != nil {
		fail(c, http.StatusInternalServerError, "store_failed", err.Error(), nil)
		return
	}
	c.JSON(http.StatusCreated, profileJSON(saved))
}

func (a *api) seedProfilesUpdate(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok || !a.seedStore(c) {
		return
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	var in seedProfileBody
	if err := c.ShouldBindJSON(&in); err != nil || len(in.Config) == 0 || !json.Valid(in.Config) {
		fail(c, http.StatusBadRequest, "bad_request", "config is required", nil)
		return
	}
	cur, err := a.store.GetSeedProfile(p.Name, id)
	if errors.Is(err, store.ErrSeedProfileNotFound) {
		fail(c, http.StatusNotFound, "seed_profile_not_found", "seed profile not found", nil)
		return
	}
	if err != nil {
		fail(c, http.StatusInternalServerError, "store_failed", err.Error(), nil)
		return
	}
	cur.Config = string(in.Config)
	saved, err := a.store.SaveSeedProfile(cur, true)
	if err != nil {
		fail(c, http.StatusInternalServerError, "store_failed", err.Error(), nil)
		return
	}
	c.JSON(http.StatusOK, profileJSON(saved))
}

func (a *api) seedProfilesDelete(c *gin.Context) {
	p, ok := a.profileOr404(c)
	if !ok || !a.seedStore(c) {
		return
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	deleted, err := a.store.DeleteSeedProfile(p.Name, id)
	switch {
	case err != nil:
		fail(c, http.StatusInternalServerError, "store_failed", err.Error(), nil)
	case !deleted:
		fail(c, http.StatusNotFound, "seed_profile_not_found", "seed profile not found", nil)
	default:
		c.Status(http.StatusNoContent)
	}
}
