// Package importer loads CSV, JSON and NDJSON records into a table: parsing,
// conversion to driver values, retried concurrent writes and row-level errors.
package importer

import (
	"bufio"
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/0funct0ry/helenus/internal/dataio/detect"
)

// Format describes how to read a file.
type Format struct {
	Kind      string `json:"format"`
	Delimiter string `json:"delimiter"`
	Quote     string `json:"quote"`
	Header    bool   `json:"header"`
	// NullString is the CSV cell text that means NULL; empty by default.
	NullString string `json:"null_string"`
}

// Record is one parsed input record.
type Record struct {
	// Line is the 1-based file line of a CSV or NDJSON record, or the position in a JSON array.
	Line int64
	// Raw is the original record: the CSV fields, or the JSON text as one element.
	Raw []string
	// Vals holds the values by source column. CSV values are strings (nil for NULL).
	Vals map[string]any
	// Err is set when the record could not be parsed; the reader carries on after it.
	Err error
	// Keys lists the JSON object's keys in text order.
	Keys []string
}

// peekRecords is how many records Open reads ahead for column discovery and type checks.
const peekRecords = 1000

// Reader yields records from one file.
type Reader struct {
	next    func() (Record, error)
	columns []string
	peeked  []Record
	pos     int
}

// Open reads ahead up to 1,000 records. Columns come from the CSV header (or
// column1…columnN), or are the keys of the first 100 JSON records.
func Open(r io.Reader, f Format) (*Reader, error) {
	rd := &Reader{}
	var err error
	switch f.Kind {
	case detect.CSV, "":
		err = rd.openCSV(r, f)
	case detect.JSON:
		err = rd.openJSON(r)
	case detect.NDJSON:
		rd.openNDJSON(r)
	default:
		return nil, fmt.Errorf("unknown format %q", f.Kind)
	}
	if err != nil {
		return nil, err
	}
	for len(rd.peeked) < peekRecords {
		rec, err := rd.next()
		if err != nil {
			break
		}
		rd.peeked = append(rd.peeked, rec)
	}
	if f.Kind == detect.JSON || f.Kind == detect.NDJSON {
		seen := map[string]bool{}
		for i, rec := range rd.peeked {
			if i >= 100 {
				break
			}
			for _, k := range rec.Keys {
				if !seen[k] {
					seen[k] = true
					rd.columns = append(rd.columns, k)
				}
			}
		}
	}
	return rd, nil
}

// Columns returns the source column names.
func (r *Reader) Columns() []string { return r.columns }

// Peeked returns the records read ahead by Open (valid and invalid).
func (r *Reader) Peeked() []Record { return r.peeked }

// Next returns the next record, or io.EOF.
func (r *Reader) Next() (Record, error) {
	if r.pos < len(r.peeked) {
		rec := r.peeked[r.pos]
		r.peeked[r.pos] = Record{}
		r.pos++
		return rec, nil
	}
	return r.next()
}

func (r *Reader) openCSV(in io.Reader, f Format) error {
	br := bufio.NewReaderSize(in, 1<<20)
	if b, _ := br.Peek(3); bytes.Equal(b, []byte{0xEF, 0xBB, 0xBF}) {
		_, _ = br.Discard(3)
	}
	cr := csv.NewReader(br)
	cr.LazyQuotes, cr.FieldsPerRecord = true, -1
	if f.Delimiter != "" {
		cr.Comma = []rune(f.Delimiter)[0]
	}
	if f.Quote != "" && f.Quote != `"` {
		// encoding/csv only quotes with "; other quote characters are rewritten below.
		return errors.New("only \" is supported as the quote character")
	}
	null := f.NullString
	var cols []string
	read := func() ([]string, int64, error) {
		rec, err := cr.Read()
		line, _ := cr.FieldPos(0)
		return rec, int64(line), err
	}
	var pending *Record
	first, line, err := read()
	if err == io.EOF {
		r.next = func() (Record, error) { return Record{}, io.EOF }
		return nil
	}
	var pe *csv.ParseError
	if err != nil && !errors.As(err, &pe) {
		return err
	}
	if f.Header && err == nil {
		cols = first
	} else {
		for i := range first {
			cols = append(cols, fmt.Sprintf("column%d", i+1))
		}
		if err == nil {
			rec := csvRecord(first, line, cols, null)
			pending = &rec
		} else {
			pending = &Record{Line: line, Err: err}
		}
	}
	r.columns = cols
	r.next = func() (Record, error) {
		if pending != nil {
			rec := *pending
			pending = nil
			return rec, nil
		}
		rec, line, err := read()
		if err == io.EOF {
			return Record{}, io.EOF
		}
		if err != nil {
			return Record{Line: line, Err: err}, nil
		}
		return csvRecord(rec, line, cols, null), nil
	}
	return nil
}

func csvRecord(fields []string, line int64, cols []string, null string) Record {
	rec := Record{Line: line, Raw: append([]string(nil), fields...)}
	if len(fields) != len(cols) {
		rec.Err = fmt.Errorf("expected %d fields, found %d", len(cols), len(fields))
		return rec
	}
	rec.Vals = make(map[string]any, len(cols))
	for i, c := range cols {
		if fields[i] == null {
			rec.Vals[c] = nil
		} else {
			rec.Vals[c] = fields[i]
		}
	}
	return rec
}

func jsonRecord(line int64, text []byte) Record {
	dec := json.NewDecoder(bytes.NewReader(text))
	dec.UseNumber()
	var obj map[string]any
	rec := Record{Line: line, Raw: []string{string(text)}}
	if err := dec.Decode(&obj); err != nil {
		rec.Err = fmt.Errorf("invalid JSON object: %w", err)
		return rec
	}
	rec.Vals = obj
	rec.Keys = keyOrder(text)
	return rec
}

// keyOrder returns the top-level keys of a JSON object in text order.
func keyOrder(text []byte) []string {
	dec := json.NewDecoder(bytes.NewReader(text))
	if _, err := dec.Token(); err != nil {
		return nil
	}
	var keys []string
	for dec.More() {
		k, err := dec.Token()
		if err != nil {
			break
		}
		keys = append(keys, fmt.Sprint(k))
		var skip json.RawMessage
		if dec.Decode(&skip) != nil {
			break
		}
	}
	return keys
}

func (r *Reader) openNDJSON(in io.Reader) {
	sc := bufio.NewScanner(in)
	sc.Buffer(make([]byte, 1<<20), 64<<20)
	var line int64
	first := true
	r.next = func() (Record, error) {
		for sc.Scan() {
			line++
			text := sc.Bytes()
			if first {
				text = detect.StripBOM(text)
				first = false
			}
			if len(bytes.TrimSpace(text)) == 0 {
				continue
			}
			return jsonRecord(line, append([]byte(nil), text...)), nil
		}
		if err := sc.Err(); err != nil {
			return Record{}, err
		}
		return Record{}, io.EOF
	}
}

func (r *Reader) openJSON(in io.Reader) error {
	br := bufio.NewReaderSize(in, 1<<20)
	if b, _ := br.Peek(3); bytes.Equal(b, []byte{0xEF, 0xBB, 0xBF}) {
		_, _ = br.Discard(3)
	}
	dec := json.NewDecoder(br)
	tok, err := dec.Token()
	if err != nil {
		return fmt.Errorf("invalid JSON: %w", err)
	}
	if d, ok := tok.(json.Delim); !ok || d != '[' {
		return errors.New("a JSON import file must be an array of objects")
	}
	var n int64
	r.next = func() (Record, error) {
		if !dec.More() {
			return Record{}, io.EOF
		}
		n++
		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			return Record{}, fmt.Errorf("invalid JSON near element %d: %w", n, err)
		}
		return jsonRecord(n, raw), nil
	}
	return nil
}

// Text renders a source value for the error file and samples.
func Text(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case json.Number:
		return x.String()
	}
	b, err := json.Marshal(v)
	if err != nil {
		return strings.TrimSpace(fmt.Sprint(v))
	}
	return string(b)
}
