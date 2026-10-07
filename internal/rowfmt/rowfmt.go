// Package rowfmt renders result-grid rows as text for the clipboard (Copy As)
// and computes the aggregate figures of the row aggregate view (SPEC §9.5.1).
// It works on wire JSON rows, decodes them with codec and does no HTTP.
package rowfmt

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/cql"
	"github.com/0funct0ry/helenus/internal/exec"
)

// Formats lists the Copy As formats in menu order.
var Formats = []string{"json", "csv", "tsv", "xml", "yaml", "markdown", "html", "sql_inserts", "sql_updates", "where"}

// Source names the single table a result came from.
type Source struct {
	Keyspace string `json:"keyspace"`
	Table    string `json:"table"`
}

// Request is the body of POST /rows/format. Rows are positional wire values,
// one per column, as returned by POST /query.
type Request struct {
	Format  string              `json:"format"`
	Source  *Source             `json:"source"`
	Columns []exec.Column       `json:"columns"`
	Rows    [][]json.RawMessage `json:"rows"`
	// Counter marks a counter table, for which SQL Updates is unavailable.
	Counter bool `json:"counter,omitempty"`
	// UDT resolves user-defined type fields from the schema; set by the server, not the client.
	UDT codec.UDTFieldTypes `json:"-"`
}

// DisabledError reports a format that cannot be produced for the given input.
type DisabledError struct{ Reason string }

func (e *DisabledError) Error() string { return e.Reason }

// ErrUnknownFormat is returned for a format name not in Formats.
var ErrUnknownFormat = errors.New("unknown format")

// table is the decoded form of a request.
type table struct {
	cols []exec.Column
	vals [][]any
	enc  codec.Encoder
	udt  codec.UDTFieldTypes
}

func decode(cols []exec.Column, rows [][]json.RawMessage, udt codec.UDTFieldTypes) (*table, error) {
	t := &table{cols: cols, udt: udt, enc: codec.Encoder{UDTFields: udt}}
	for r, row := range rows {
		if len(row) != len(cols) {
			return nil, fmt.Errorf("row %d has %d values for %d columns", r+1, len(row), len(cols))
		}
		out := make([]any, len(cols))
		for i, raw := range row {
			if bytes.Contains(raw, []byte(`"$truncated"`)) {
				var tr codec.Truncated
				if err := json.Unmarshal(raw, &tr); err == nil && tr.Truncated {
					out[i] = tr
					continue
				}
			}
			v, err := codec.Decode(raw, cols[i].Type, udt)
			if err != nil {
				return nil, fmt.Errorf("row %d column %q: %w", r+1, cols[i].Name, err)
			}
			out[i] = v
		}
		t.vals = append(t.vals, out)
	}
	return t, nil
}

// text renders cell (r, c); null reports a NULL.
func (t *table) text(r, c int) (string, bool) {
	v := t.vals[r][c]
	if v == nil {
		return "", true
	}
	if tr, ok := v.(codec.Truncated); ok {
		return tr.Preview + "…", false
	}
	return t.enc.Text(v, t.cols[c].Type), false
}

func (t *table) literal(r, c int) (string, error) {
	v := t.vals[r][c]
	if _, ok := v.(codec.Truncated); ok {
		return "", &DisabledError{Reason: fmt.Sprintf("column %q holds a truncated blob and cannot be written as a literal", t.cols[c].Name)}
	}
	return cql.RenderLiteralUDT(v, t.cols[c].Type, t.udt), nil
}

// Format renders the request. The text has no trailing newline.
func Format(req Request) (string, error) {
	known := false
	for _, f := range Formats {
		known = known || f == req.Format
	}
	if !known {
		return "", fmt.Errorf("%w %q", ErrUnknownFormat, req.Format)
	}
	t, err := decode(req.Columns, req.Rows, req.UDT)
	if err != nil {
		return "", err
	}
	var s string
	switch req.Format {
	case "json":
		s, err = t.json()
	case "csv":
		s, err = t.csv()
	case "tsv":
		s = t.tsv()
	case "xml":
		s = t.xml()
	case "yaml":
		s, err = t.yaml()
	case "markdown":
		s = t.markdown()
	case "html":
		s = t.html()
	case "sql_inserts":
		s, err = t.inserts(req.Source)
	case "sql_updates":
		s, err = t.updates(req.Source, req.Counter)
	case "where":
		s, err = t.where(req.Source)
	}
	return strings.TrimRight(s, "\n"), err
}

type orderedObject struct {
	keys []string
	vals []any
}

func (o orderedObject) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, k := range o.keys {
		if i > 0 {
			b.WriteByte(',')
		}
		kb, _ := json.Marshal(k)
		b.Write(kb)
		b.WriteByte(':')
		vb, err := marshalNoEscape(o.vals[i])
		if err != nil {
			return nil, err
		}
		b.Write(vb)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

func marshalNoEscape(v any) ([]byte, error) {
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	if err := e.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(b.Bytes(), "\n"), nil
}

func (t *table) json() (string, error) {
	out := make([]orderedObject, 0, len(t.vals))
	for r := range t.vals {
		o := orderedObject{}
		for c, col := range t.cols {
			o.keys = append(o.keys, col.Name)
			o.vals = append(o.vals, t.jsonValue(r, c))
		}
		out = append(out, o)
	}
	b, err := marshalNoEscape(out)
	if err != nil {
		return "", err
	}
	var ind bytes.Buffer
	if err := json.Indent(&ind, b, "", "  "); err != nil {
		return "", err
	}
	return ind.String(), nil
}

func (t *table) jsonValue(r, c int) any {
	v := t.vals[r][c]
	if tr, ok := v.(codec.Truncated); ok {
		return tr
	}
	return t.enc.JSON(v, t.cols[c].Type)
}

func (t *table) csv() (string, error) {
	var b bytes.Buffer
	w := csv.NewWriter(&b)
	head := make([]string, len(t.cols))
	for i, c := range t.cols {
		head[i] = c.Name
	}
	if err := w.Write(head); err != nil {
		return "", err
	}
	for r := range t.vals {
		rec := make([]string, len(t.cols))
		for c := range t.cols {
			rec[c], _ = t.text(r, c)
		}
		if err := w.Write(rec); err != nil {
			return "", err
		}
	}
	w.Flush()
	return b.String(), w.Error()
}

var tsvEscaper = strings.NewReplacer("\\", `\\`, "\t", `\t`, "\n", `\n`, "\r", `\r`)

func (t *table) tsv() string {
	lines := make([]string, 0, len(t.vals)+1)
	head := make([]string, len(t.cols))
	for i, c := range t.cols {
		head[i] = tsvEscaper.Replace(c.Name)
	}
	lines = append(lines, strings.Join(head, "\t"))
	for r := range t.vals {
		f := make([]string, len(t.cols))
		for c := range t.cols {
			s, _ := t.text(r, c)
			f[c] = tsvEscaper.Replace(s)
		}
		lines = append(lines, strings.Join(f, "\t"))
	}
	return strings.Join(lines, "\n")
}

func xmlEsc(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&#34;", "'", "&#39;", "\t", "&#x9;", "\n", "&#xA;", "\r", "&#xD;").Replace(s)
}

// xml follows internal/dataio/export/xml.go: <col name="…"> elements, and
// nil="true" for NULL.
func (t *table) xml() string {
	var b strings.Builder
	b.WriteString("<rows>\n")
	for r := range t.vals {
		b.WriteString("<row>")
		for c, col := range t.cols {
			name := xmlEsc(col.Name)
			s, null := t.text(r, c)
			if null {
				b.WriteString(`<col name="` + name + `" nil="true"/>`)
				continue
			}
			b.WriteString(`<col name="` + name + `">` + xmlEsc(s) + `</col>`)
		}
		b.WriteString("</row>\n")
	}
	b.WriteString("</rows>")
	return b.String()
}

func (t *table) scalarNode(r, c int) *yaml.Node {
	s, null := t.text(r, c)
	if null {
		return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!null", Value: "null"}
	}
	switch strings.ToLower(t.cols[c].Type.Name) {
	case "tinyint", "smallint", "int", "bigint", "varint", "counter":
		return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!int", Value: s}
	case "float", "double", "decimal":
		if f := strings.ToLower(s); !strings.Contains(f, "nan") && !strings.Contains(f, "inf") && !strings.ContainsAny(s, "eE") {
			return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!float", Value: s}
		}
	case "boolean":
		return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!bool", Value: s}
	case "ascii", "text", "varchar", "uuid", "timeuuid", "timestamp", "date", "time", "inet", "duration", "blob":
	default: // collections, tuples, UDTs, vectors
		var n yaml.Node
		if err := n.Encode(t.jsonValue(r, c)); err == nil {
			return &n
		}
	}
	var n yaml.Node
	_ = n.Encode(s)
	return &n
}

func (t *table) yaml() (string, error) {
	seq := &yaml.Node{Kind: yaml.SequenceNode}
	for r := range t.vals {
		m := &yaml.Node{Kind: yaml.MappingNode}
		for c, col := range t.cols {
			var k yaml.Node
			_ = k.Encode(col.Name)
			m.Content = append(m.Content, &k, t.scalarNode(r, c))
		}
		seq.Content = append(seq.Content, m)
	}
	if len(t.vals) == 0 {
		seq.Style = yaml.FlowStyle
	}
	var b bytes.Buffer
	e := yaml.NewEncoder(&b)
	e.SetIndent(2)
	if err := e.Encode(seq); err != nil {
		return "", err
	}
	if err := e.Close(); err != nil {
		return "", err
	}
	return b.String(), nil
}

var mdEscaper = strings.NewReplacer("|", `\|`, "\r\n", "<br>", "\n", "<br>", "\r", "<br>")

func (t *table) markdown() string {
	var b strings.Builder
	b.WriteString("|")
	for _, c := range t.cols {
		b.WriteString(" " + mdEscaper.Replace(c.Name) + " |")
	}
	b.WriteString("\n|")
	for range t.cols {
		b.WriteString(" --- |")
	}
	for r := range t.vals {
		b.WriteString("\n|")
		for c := range t.cols {
			s, _ := t.text(r, c)
			b.WriteString(" " + mdEscaper.Replace(s) + " |")
		}
	}
	return b.String()
}

func (t *table) html() string {
	var b strings.Builder
	b.WriteString("<table>\n<thead>\n<tr>")
	for _, c := range t.cols {
		b.WriteString("<th>" + html.EscapeString(c.Name) + "</th>")
	}
	b.WriteString("</tr>\n</thead>\n<tbody>\n")
	for r := range t.vals {
		b.WriteString("<tr>")
		for c := range t.cols {
			s, null := t.text(r, c)
			if null {
				b.WriteString(`<td class="null"></td>`)
				continue
			}
			b.WriteString("<td>" + html.EscapeString(s) + "</td>")
		}
		b.WriteString("</tr>\n")
	}
	b.WriteString("</tbody>\n</table>")
	return b.String()
}

func qualified(src *Source) (string, error) {
	if src == nil || src.Table == "" {
		return "", &DisabledError{Reason: "the result does not come from a single table"}
	}
	if src.Keyspace == "" {
		return cql.QuoteIdent(src.Table), nil
	}
	return cql.QuoteIdent(src.Keyspace) + "." + cql.QuoteIdent(src.Table), nil
}

// keyColumns returns the indexes of the primary-key columns in primary-key
// order (partition by position, then clustering by position), or an error
// when the table has none visible or the count of key columns is inconsistent.
func (t *table) keyColumns() ([]int, error) {
	var part, clus []int
	for i, c := range t.cols {
		switch c.Kind {
		case "partition":
			part = append(part, i)
		case "clustering":
			clus = append(clus, i)
		}
	}
	byPos := func(ix []int) {
		for i := 1; i < len(ix); i++ {
			for j := i; j > 0 && t.cols[ix[j]].Position < t.cols[ix[j-1]].Position; j-- {
				ix[j], ix[j-1] = ix[j-1], ix[j]
			}
		}
	}
	byPos(part)
	byPos(clus)
	keys := append(part, clus...)
	if len(part) == 0 {
		return nil, &DisabledError{Reason: "the result is missing the partition key columns"}
	}
	for i, c := range t.cols {
		if (c.Kind == "partition" || c.Kind == "clustering") && c.Position < 0 {
			return nil, &DisabledError{Reason: fmt.Sprintf("column %q has no key position", t.cols[i].Name)}
		}
	}
	return keys, nil
}

func (t *table) inserts(src *Source) (string, error) {
	q, err := qualified(src)
	if err != nil {
		return "", err
	}
	names := make([]string, len(t.cols))
	for i, c := range t.cols {
		names[i] = cql.QuoteIdent(c.Name)
	}
	var lines []string
	for r := range t.vals {
		lits := make([]string, len(t.cols))
		for c := range t.cols {
			if lits[c], err = t.literal(r, c); err != nil {
				return "", err
			}
		}
		lines = append(lines, "INSERT INTO "+q+" ("+strings.Join(names, ", ")+") VALUES ("+strings.Join(lits, ", ")+");")
	}
	return strings.Join(lines, "\n"), nil
}

func (t *table) condition(r int, keys []int) (string, error) {
	parts := make([]string, len(keys))
	for i, k := range keys {
		lit, err := t.literal(r, k)
		if err != nil {
			return "", err
		}
		parts[i] = cql.QuoteIdent(t.cols[k].Name) + " = " + lit
	}
	return strings.Join(parts, " AND "), nil
}

func (t *table) updates(src *Source, counter bool) (string, error) {
	q, err := qualified(src)
	if err != nil {
		return "", err
	}
	if counter {
		return "", &DisabledError{Reason: "counter tables are updated with increments, not assignments"}
	}
	keys, err := t.keyColumns()
	if err != nil {
		return "", err
	}
	isKey := map[int]bool{}
	for _, k := range keys {
		isKey[k] = true
	}
	var sets []int
	for c := range t.cols {
		if !isKey[c] {
			sets = append(sets, c)
		}
	}
	if len(sets) == 0 {
		return "", &DisabledError{Reason: "the result has no non-key columns to update"}
	}
	var lines []string
	for r := range t.vals {
		assigns := make([]string, len(sets))
		for i, c := range sets {
			lit, err := t.literal(r, c)
			if err != nil {
				return "", err
			}
			assigns[i] = cql.QuoteIdent(t.cols[c].Name) + " = " + lit
		}
		cond, err := t.condition(r, keys)
		if err != nil {
			return "", err
		}
		lines = append(lines, "UPDATE "+q+" SET "+strings.Join(assigns, ", ")+" WHERE "+cond+";")
	}
	return strings.Join(lines, "\n"), nil
}

func (t *table) where(src *Source) (string, error) {
	if _, err := qualified(src); err != nil {
		return "", err
	}
	keys, err := t.keyColumns()
	if err != nil {
		return "", err
	}
	var lines []string
	for r := range t.vals {
		cond, err := t.condition(r, keys)
		if err != nil {
			return "", err
		}
		lines = append(lines, cond)
	}
	return strings.Join(lines, "\n"), nil
}
