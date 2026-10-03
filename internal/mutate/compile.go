package mutate

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/cql"
	"github.com/0funct0ry/helenus/internal/schema"
)

// Compile checks changes against table and compiles each to a prepared
// statement. Nothing is returned unless every change is valid: the result is a
// *ValidationError listing the bad ones, ErrTableNotFound, or a *ReadOnlyError.
func Compile(snap *schema.Snapshot, keyspace, table string, changes []Change) ([]Statement, error) {
	if snap == nil {
		return nil, ErrTableNotFound
	}
	ks := snap.Keyspace(keyspace)
	if ks == nil {
		return nil, ErrTableNotFound
	}
	t := ks.Table(table)
	if t == nil {
		if ks.View(table) != nil {
			return nil, &ReadOnlyError{Reason: "materialized views are read-only"}
		}
		return nil, ErrTableNotFound
	}
	if ks.System {
		return nil, &ReadOnlyError{Reason: "system keyspaces are read-only"}
	}
	c := &compiler{snap: snap, t: t, qualified: cql.QuoteIdent(keyspace) + "." + cql.QuoteIdent(table)}
	var out []Statement
	var errs []ChangeError
	for i, ch := range changes {
		st, err := c.compile(ch)
		if err != nil {
			errs = append(errs, ChangeError{Index: i, Message: err.Error()})
			continue
		}
		st.Index = i
		st.Kind = ch.Kind
		out = append(out, st)
	}
	if len(errs) > 0 {
		return nil, &ValidationError{Errors: errs}
	}
	return out, nil
}

type compiler struct {
	snap      *schema.Snapshot
	t         *schema.Table
	qualified string
}

// builder writes the prepared text and its literal preview side by side.
type builder struct {
	c       *compiler
	cql     strings.Builder
	preview strings.Builder
	args    []any
}

func (b *builder) text(s string) {
	b.cql.WriteString(s)
	b.preview.WriteString(s)
}

// bind writes a ? marker and records v as its bound value.
//
// A marker whose type is a tuple is the exception: the driver (v2.1) counts a
// tuple marker as one value per element when it prepares a statement but marshals
// one value per marker, so a tuple cannot be bound. It is written into the
// statement as a literal rendered from the already validated value instead.
func (b *builder) bind(v any, td codec.TypeDesc) {
	lit := cql.RenderLiteralUDT(v, td, b.c.snap.UDTFields)
	b.preview.WriteString(lit)
	if td.Name == "tuple" && v != nil {
		b.cql.WriteString(lit)
		return
	}
	b.cql.WriteString("?")
	b.args = append(b.args, v)
}

func (c *compiler) column(name string) (*schema.Column, error) {
	if name == "" {
		return nil, fmt.Errorf("a column is required")
	}
	for i := range c.t.Columns {
		if c.t.Columns[i].Name == name {
			return &c.t.Columns[i], nil
		}
	}
	return nil, fmt.Errorf("table %s has no column %q", c.t.Name, name)
}

func isKey(col *schema.Column) bool {
	return col.Kind == schema.KindPartition || col.Kind == schema.KindClustering
}

// multiCell reports whether td is a non-frozen collection or UDT, the only
// values that accept element-wise changes.
func multiCell(td codec.TypeDesc) bool {
	if td.Frozen {
		return false
	}
	switch td.Name {
	case "list", "set", "map":
		return true
	}
	return td.UDT != nil
}

// keyColumns returns the columns a WHERE clause needs: the partition key for a
// static column, the full primary key otherwise.
func (c *compiler) keyColumns(partitionOnly bool) []schema.Column {
	var out []schema.Column
	for _, col := range c.t.Columns {
		if col.Kind == schema.KindPartition || (!partitionOnly && col.Kind == schema.KindClustering) {
			out = append(out, col)
		}
	}
	return out
}

func (c *compiler) where(b *builder, key map[string]json.RawMessage, partitionOnly bool) error {
	cols := c.keyColumns(partitionOnly)
	for i, col := range cols {
		raw, ok := key[col.Name]
		if !ok || isNull(raw) {
			return fmt.Errorf("the primary key value for %s is missing", col.Name)
		}
		v, err := codec.Decode(raw, col.Type, c.snap.UDTFields)
		if err != nil {
			return fmt.Errorf("key %s: %w", col.Name, err)
		}
		if i == 0 {
			b.text(" WHERE ")
		} else {
			b.text(" AND ")
		}
		b.text(cql.QuoteIdent(col.Name) + " = ")
		b.bind(v, col.Type)
	}
	return nil
}

func isNull(raw json.RawMessage) bool {
	s := strings.TrimSpace(string(raw))
	return s == "" || s == "null"
}

func (c *compiler) compile(ch Change) (Statement, error) {
	if c.t.Counter && ch.Kind != CounterDelta {
		return Statement{}, fmt.Errorf("counter tables accept counter increments only")
	}
	b := &builder{c: c}
	var summary string
	var err error
	switch ch.Kind {
	case InsertRow:
		summary, err = c.insert(b, ch)
	case DeleteRow:
		b.text("DELETE FROM " + c.qualified)
		err = c.where(b, ch.Key, false)
		summary = "delete row"
	case SetCell, ReplaceValue:
		summary, err = c.setValue(b, ch)
	case SetNull:
		summary, err = c.setNull(b, ch)
	case CounterDelta:
		summary, err = c.counter(b, ch)
	case ListAppend, ListPrepend, SetAdd, SetRemove:
		summary, err = c.collectionOp(b, ch)
	case ListSetIndex, ListRemoveIndex, MapPut, MapRemove:
		summary, err = c.elementOp(b, ch)
	case UDTFieldSet:
		summary, err = c.udtField(b, ch)
	default:
		return Statement{}, fmt.Errorf("unknown change kind %q", ch.Kind)
	}
	if err != nil {
		return Statement{}, err
	}
	b.text(";")
	if ch.Kind == InsertRow && ch.IfNotExists {
		// IF NOT EXISTS goes before the semicolon.
		s, p := b.cql.String(), b.preview.String()
		b.cql.Reset()
		b.preview.Reset()
		b.cql.WriteString(strings.TrimSuffix(s, ";") + " IF NOT EXISTS;")
		b.preview.WriteString(strings.TrimSuffix(p, ";") + " IF NOT EXISTS;")
	}
	return Statement{CQL: b.cql.String(), Preview: b.preview.String(), Summary: summary, Args: b.args}, nil
}

func (c *compiler) insert(b *builder, ch Change) (string, error) {
	for name := range ch.Values {
		if _, err := c.column(name); err != nil {
			return "", err
		}
	}
	var names []string
	var vals []any
	var types []codec.TypeDesc
	for _, col := range c.t.Columns {
		raw, ok := ch.Values[col.Name]
		if !ok || isNull(raw) {
			if isKey(&col) {
				return "", fmt.Errorf("the primary key value for %s is required", col.Name)
			}
			continue
		}
		v, err := codec.Decode(raw, col.Type, c.snap.UDTFields)
		if err != nil {
			return "", fmt.Errorf("%s: %w", col.Name, err)
		}
		names = append(names, cql.QuoteIdent(col.Name))
		vals = append(vals, v)
		types = append(types, col.Type)
	}
	b.text("INSERT INTO " + c.qualified + " (" + strings.Join(names, ", ") + ") VALUES (")
	for i := range vals {
		if i > 0 {
			b.text(", ")
		}
		b.bind(vals[i], types[i])
	}
	b.text(")")
	return "insert row", nil
}

// target resolves the column a value change applies to and rejects primary key
// and counter columns.
func (c *compiler) target(ch Change) (*schema.Column, error) {
	col, err := c.column(ch.Column)
	if err != nil {
		return nil, err
	}
	if isKey(col) {
		return nil, fmt.Errorf("%s is part of the primary key and cannot be edited; insert a new row instead", col.Name)
	}
	return col, nil
}

// beginUpdate starts an UPDATE and reports whether its WHERE clause is keyed by
// the partition key only (static columns).
func (c *compiler) beginUpdate(b *builder, col *schema.Column) (partitionOnly bool) {
	b.text("UPDATE " + c.qualified + " SET ")
	return col.Kind == schema.KindStatic
}

func (c *compiler) setValue(b *builder, ch Change) (string, error) {
	col, err := c.target(ch)
	if err != nil {
		return "", err
	}
	if col.Type.Name == "counter" {
		return "", fmt.Errorf("%s is a counter; enter an increment instead", col.Name)
	}
	v, err := codec.Decode(ch.Value, col.Type, c.snap.UDTFields)
	if err != nil {
		return "", fmt.Errorf("%s: %w", col.Name, err)
	}
	if v == nil {
		return "", fmt.Errorf("%s: a value is required; use set_null to clear the cell", col.Name)
	}
	po := c.beginUpdate(b, col)
	b.text(cql.QuoteIdent(col.Name) + " = ")
	b.bind(v, col.Type)
	return "set " + col.Name, c.where(b, ch.Key, po)
}

func (c *compiler) setNull(b *builder, ch Change) (string, error) {
	col, err := c.target(ch)
	if err != nil {
		return "", err
	}
	if col.Type.Name == "counter" {
		return "", fmt.Errorf("%s is a counter and cannot be set to null", col.Name)
	}
	b.text("DELETE " + cql.QuoteIdent(col.Name) + " FROM " + c.qualified)
	return "clear " + col.Name, c.where(b, ch.Key, col.Kind == schema.KindStatic)
}

func (c *compiler) counter(b *builder, ch Change) (string, error) {
	col, err := c.target(ch)
	if err != nil {
		return "", err
	}
	if col.Type.Name != "counter" {
		return "", fmt.Errorf("%s is not a counter column", col.Name)
	}
	v, err := codec.Decode(ch.Value, col.Type, c.snap.UDTFields)
	if err != nil {
		return "", fmt.Errorf("%s: %w", col.Name, err)
	}
	if v == nil {
		return "", fmt.Errorf("an increment is required")
	}
	po := c.beginUpdate(b, col)
	n := cql.QuoteIdent(col.Name)
	b.text(n + " = " + n + " + ")
	b.bind(v, col.Type)
	return "increment " + col.Name, c.where(b, ch.Key, po)
}

// collectionOp compiles whole-collection arithmetic: append, prepend, add, remove.
func (c *compiler) collectionOp(b *builder, ch Change) (string, error) {
	col, err := c.target(ch)
	if err != nil {
		return "", err
	}
	want := "list"
	if ch.Kind == SetAdd || ch.Kind == SetRemove {
		want = "set"
	}
	if col.Type.Name != want {
		return "", fmt.Errorf("%s is not a %s", col.Name, want)
	}
	if !multiCell(col.Type) {
		return "", fmt.Errorf("%s is frozen; replace the whole value instead", col.Name)
	}
	v, err := codec.Decode(ch.Value, col.Type, c.snap.UDTFields)
	if err != nil {
		return "", fmt.Errorf("%s: %w", col.Name, err)
	}
	if v == nil {
		return "", fmt.Errorf("a list of elements is required")
	}
	po := c.beginUpdate(b, col)
	n := cql.QuoteIdent(col.Name)
	b.text(n + " = ")
	switch ch.Kind {
	case ListAppend, SetAdd:
		b.text(n + " + ")
		b.bind(v, col.Type)
	case ListPrepend:
		b.bind(v, col.Type)
		b.text(" + " + n)
	case SetRemove:
		b.text(n + " - ")
		b.bind(v, col.Type)
	}
	verbs := map[Kind]string{ListAppend: "append to", ListPrepend: "prepend to", SetAdd: "add to", SetRemove: "remove from"}
	return verbs[ch.Kind] + " " + col.Name, c.where(b, ch.Key, po)
}

// elementOp compiles list index and map key changes.
func (c *compiler) elementOp(b *builder, ch Change) (string, error) {
	col, err := c.target(ch)
	if err != nil {
		return "", err
	}
	isList := ch.Kind == ListSetIndex || ch.Kind == ListRemoveIndex
	want := "map"
	if isList {
		want = "list"
	}
	if col.Type.Name != want {
		return "", fmt.Errorf("%s is not a %s", col.Name, want)
	}
	if !multiCell(col.Type) {
		return "", fmt.Errorf("%s is frozen; replace the whole value instead", col.Name)
	}
	n := cql.QuoteIdent(col.Name)
	po := col.Kind == schema.KindStatic
	var keyType codec.TypeDesc
	var keyVal any
	if isList {
		if ch.Index == nil || *ch.Index < 0 {
			return "", fmt.Errorf("a list index is required")
		}
		keyType, keyVal = codec.TypeDesc{Name: "int"}, int32(*ch.Index)
	} else {
		if isNull(ch.MapKey) {
			return "", fmt.Errorf("a map key is required")
		}
		keyType = col.Type.Args[0]
		if keyVal, err = codec.Decode(ch.MapKey, keyType, c.snap.UDTFields); err != nil {
			return "", fmt.Errorf("%s key: %w", col.Name, err)
		}
	}
	switch ch.Kind {
	case ListRemoveIndex, MapRemove:
		b.text("DELETE " + n + "[")
		b.bind(keyVal, keyType)
		b.text("] FROM " + c.qualified)
	default:
		elem := col.Type.Args[len(col.Type.Args)-1]
		v, err := codec.Decode(ch.Value, elem, c.snap.UDTFields)
		if err != nil {
			return "", fmt.Errorf("%s value: %w", col.Name, err)
		}
		if v == nil {
			return "", fmt.Errorf("a value is required")
		}
		b.text("UPDATE " + c.qualified + " SET " + n + "[")
		b.bind(keyVal, keyType)
		b.text("] = ")
		b.bind(v, elem)
	}
	verbs := map[Kind]string{ListSetIndex: "set item of", ListRemoveIndex: "remove item of", MapPut: "put entry in", MapRemove: "remove entry from"}
	return verbs[ch.Kind] + " " + col.Name, c.where(b, ch.Key, po)
}

func (c *compiler) udtField(b *builder, ch Change) (string, error) {
	col, err := c.target(ch)
	if err != nil {
		return "", err
	}
	if col.Type.UDT == nil {
		return "", fmt.Errorf("%s is not a user-defined type", col.Name)
	}
	if !multiCell(col.Type) {
		return "", fmt.Errorf("%s is frozen; replace the whole value instead", col.Name)
	}
	fields := c.snap.UDTFields(*col.Type.UDT)
	ft, ok := fields[ch.Field]
	if !ok {
		return "", fmt.Errorf("type %s has no field %q", col.Type.Name, ch.Field)
	}
	v, err := codec.Decode(ch.Value, ft, c.snap.UDTFields)
	if err != nil {
		return "", fmt.Errorf("%s.%s: %w", col.Name, ch.Field, err)
	}
	po := c.beginUpdate(b, col)
	b.text(cql.QuoteIdent(col.Name) + "." + cql.QuoteIdent(ch.Field) + " = ")
	b.bind(v, ft)
	return "set " + col.Name + "." + ch.Field, c.where(b, ch.Key, po)
}
