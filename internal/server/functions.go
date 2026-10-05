package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/cql"
	"github.com/0funct0ry/helenus/internal/exec"
	"github.com/0funct0ry/helenus/internal/schema"
)

// functionsPreview validates a function create, replace or drop request against the cached schema and
// returns the statement (SPEC §9.20). Nothing is executed; the client sends the statement through /query.
func (a *api) functionsPreview(c *gin.Context) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return
	}
	var in schema.FunctionRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	snap, err := a.conn.Schema(c.Request.Context(), p.Name, p, false)
	if err != nil {
		fail(c, http.StatusBadGateway, "schema_failed", err.Error(), nil)
		return
	}
	c.JSON(http.StatusOK, schema.PlanFunction(snap, in))
}

type invokeRequest struct {
	Keyspace  string            `json:"keyspace"`
	Name      string            `json:"name"`
	Signature string            `json:"signature"`
	Args      []json.RawMessage `json:"args"`
}

type invokeResult struct {
	Value     any            `json:"value"`
	Type      codec.TypeDesc `json:"type"`
	ElapsedMS float64        `json:"elapsed_ms"`
	CQL       string         `json:"cql"`
}

// functionsInvoke calls a UDF with literal arguments through `SELECT ks.f(...) FROM system.local`.
func (a *api) functionsInvoke(c *gin.Context) {
	p, ok := a.connectedProfile(c)
	if !ok {
		return
	}
	var in invokeRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	snap, err := a.conn.Schema(c.Request.Context(), p.Name, p, false)
	if err != nil {
		fail(c, http.StatusBadGateway, "schema_failed", err.Error(), nil)
		return
	}
	var fn *schema.Function
	if ks := snap.Keyspace(in.Keyspace); ks != nil {
		for i, f := range ks.Functions {
			if f.Name == in.Name && f.Signature() == in.Signature {
				fn = &ks.Functions[i]
			}
		}
	}
	if fn == nil {
		fail(c, http.StatusNotFound, "not_found", fmt.Sprintf("function %s.%s not found", in.Keyspace, in.Signature), nil)
		return
	}
	if len(in.Args) != len(fn.ArgTypes) {
		fail(c, http.StatusBadRequest, "bad_request", fmt.Sprintf("%s takes %d arguments, got %d", fn.Name, len(fn.ArgTypes), len(in.Args)), nil)
		return
	}
	lits := make([]string, len(in.Args))
	for i, raw := range in.Args {
		td, err := codec.Parse(fn.ArgTypes[i], fn.Keyspace)
		if err != nil {
			fail(c, http.StatusInternalServerError, "invoke_failed", err.Error(), nil)
			return
		}
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.UseNumber()
		var v any
		if err := dec.Decode(&v); err != nil {
			fail(c, http.StatusBadRequest, "bad_request", fmt.Sprintf("argument %d: %v", i+1, err), nil)
			return
		}
		lit, err := jsonLiteral(v, td, snap)
		if err != nil {
			fail(c, http.StatusBadRequest, "bad_request", fmt.Sprintf("argument %d: %v", i+1, err), nil)
			return
		}
		lits[i] = lit
	}
	stmt := fmt.Sprintf("SELECT %s(%s) AS result FROM system.local;", schema.Ident(fn.Keyspace)+"."+schema.Ident(fn.Name), strings.Join(lits, ", "))
	start := time.Now()
	res, err := a.conn.Query(c.Request.Context(), p.Name, p, exec.Request{CQL: stmt})
	elapsed := float64(time.Since(start).Microseconds()) / 1000
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, "invoke_failed", err.Error(), nil)
		return
	}
	out := invokeResult{ElapsedMS: elapsed, CQL: stmt}
	if res != nil && len(res.Rows) > 0 && len(res.Rows[0]) > 0 {
		out.Value = res.Rows[0][0]
		if len(res.Columns) > 0 {
			out.Type = res.Columns[0].Type
		}
	}
	c.JSON(http.StatusOK, out)
}

// bareLiteral is what an unquoted literal (number, uuid, blob, duration) may contain, so a string cannot add CQL.
var bareLiteral = regexp.MustCompile(`^[A-Za-z0-9+\-.:_]+$`)

// jsonLiteral renders a decoded JSON value as a CQL literal of type td.
func jsonLiteral(v any, td codec.TypeDesc, snap *schema.Snapshot) (string, error) {
	if v == nil {
		return "null", nil
	}
	name := strings.ToLower(td.Name)
	switch {
	case td.UDT != nil:
		m, ok := v.(map[string]any)
		if !ok {
			return "", fmt.Errorf("expected an object for type %s", td.UDT.Name)
		}
		fields := snap.UDTFields(*td.UDT)
		keys := make([]string, 0, len(m))
		for k := range m {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, k := range keys {
			ft, ok := fields[k]
			if !ok {
				return "", fmt.Errorf("type %s has no field %s", td.UDT.Name, k)
			}
			l, err := jsonLiteral(m[k], ft, snap)
			if err != nil {
				return "", err
			}
			parts = append(parts, schema.Ident(k)+": "+l)
		}
		return "{" + strings.Join(parts, ", ") + "}", nil
	case name == "list" || name == "set" || name == "vector" || name == "tuple":
		arr, ok := v.([]any)
		if !ok {
			return "", fmt.Errorf("expected an array for %s", name)
		}
		parts := make([]string, len(arr))
		for i, e := range arr {
			et := td.Args[0]
			if name == "tuple" {
				if i >= len(td.Args) {
					return "", fmt.Errorf("tuple has %d elements, got more", len(td.Args))
				}
				et = td.Args[i]
			}
			l, err := jsonLiteral(e, et, snap)
			if err != nil {
				return "", err
			}
			parts[i] = l
		}
		switch name {
		case "set":
			return "{" + strings.Join(parts, ", ") + "}", nil
		case "tuple":
			return "(" + strings.Join(parts, ", ") + ")", nil
		}
		return "[" + strings.Join(parts, ", ") + "]", nil
	case name == "map":
		m, ok := v.(map[string]any)
		if !ok || len(td.Args) != 2 {
			return "", fmt.Errorf("expected an object for map")
		}
		keys := make([]string, 0, len(m))
		for k := range m {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, k := range keys {
			kl, err := jsonLiteral(k, td.Args[0], snap)
			if err != nil {
				return "", err
			}
			vl, err := jsonLiteral(m[k], td.Args[1], snap)
			if err != nil {
				return "", err
			}
			parts = append(parts, kl+": "+vl)
		}
		return "{" + strings.Join(parts, ", ") + "}", nil
	}
	switch x := v.(type) {
	case json.Number:
		if name == "text" || name == "varchar" || name == "ascii" {
			return cql.QuoteString(x.String()), nil
		}
		return x.String(), nil
	case bool:
		return fmt.Sprintf("%t", x), nil
	case string:
		switch name {
		case "uuid", "timeuuid", "blob", "duration", "decimal", "varint", "bigint", "int", "smallint", "tinyint", "float", "double":
			if !bareLiteral.MatchString(x) {
				return "", fmt.Errorf("%q is not a valid %s", x, name)
			}
			return x, nil
		}
		return cql.QuoteString(x), nil
	}
	return "", fmt.Errorf("unsupported value %v for type %s", v, name)
}
