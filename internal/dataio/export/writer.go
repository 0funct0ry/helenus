// Package export streams query results and whole tables to files in common
// formats (SPEC §9.27). It pages through a Runner and never holds more than one
// page in memory.
package export

import (
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/exec"
)

// Format names.
const (
	CSV    = "csv"
	JSON   = "json"
	NDJSON = "ndjson"
	XML    = "xml"
	Excel  = "excel"
	CQL    = "cql"
)

// Formats lists the supported formats with their file extensions.
var Formats = map[string]string{CSV: "csv", JSON: "json", NDJSON: "ndjson", XML: "xml", Excel: "xlsx", CQL: "cql"}

// ExcelMaxRows is the most data rows an Excel export writes (one row is the header).
const ExcelMaxRows = 1048575

// ErrExcelLimit is returned when an Excel export would exceed the sheet size.
var ErrExcelLimit = fmt.Errorf("Excel allows 1,048,576 rows; use CSV for more")

// Options are the format options. The zero value means the defaults.
type Options struct {
	// Header writes the column names first (CSV, Excel).
	Header bool `json:"header"`
	// Delimiter is the CSV field separator: "," ";" "\t" or "|".
	Delimiter string `json:"delimiter"`
	// Quote is the CSV quote character, default `"`.
	Quote string `json:"quote"`
	// NullString is written for NULL in CSV, default empty.
	NullString string `json:"null_string"`
	// DateTimeFormat is a strftime pattern for timestamps in text formats.
	DateTimeFormat string `json:"datetime_format"`
	// LineTerminator ends CSV records; empty means CRLF (RFC 4180). COPY uses "\n".
	LineTerminator string `json:"-"`
	// Table names the target of CQL INSERT output, as keyspace.table.
	Table string `json:"table"`
}

// Writer receives the result columns once, then every row of raw driver values.
type Writer interface {
	Begin(cols []exec.Column) error
	Row(raw []any) error
	// End finishes the output; it is not called after an error.
	End() error
}

// Validate checks the options for format.
func (o Options) Validate(format string) error {
	if _, ok := Formats[format]; !ok {
		return fmt.Errorf("unknown export format %q", format)
	}
	if format == CSV {
		if d := o.delim(); len([]rune(d)) != 1 {
			return fmt.Errorf("delimiter must be a single character")
		}
		if q := o.quote(); len([]rune(q)) != 1 {
			return fmt.Errorf("quote must be a single character")
		}
		if o.delim() == o.quote() {
			return fmt.Errorf("delimiter and quote must differ")
		}
	}
	return nil
}

func (o Options) eol() string {
	if o.LineTerminator == "" {
		return "\r\n"
	}
	return o.LineTerminator
}

func (o Options) delim() string {
	if o.Delimiter == "" {
		return ","
	}
	return o.Delimiter
}

func (o Options) quote() string {
	if o.Quote == "" {
		return `"`
	}
	return o.Quote
}

// NewWriter returns the writer for format over w. udt resolves UDT field types.
func NewWriter(format string, w io.Writer, o Options, udt func(codec.UDTRef) map[string]codec.TypeDesc) (Writer, error) {
	if err := o.Validate(format); err != nil {
		return nil, err
	}
	base := cells{enc: codec.Encoder{UDTFields: udt}, layout: strftime(o.DateTimeFormat)}
	switch format {
	case CSV:
		return &csvWriter{w: w, o: o, cells: base}, nil
	case JSON:
		return &jsonWriter{w: w, cells: base}, nil
	case NDJSON:
		return &jsonWriter{w: w, cells: base, lines: true}, nil
	case XML:
		return &xmlWriter{w: w, cells: base}, nil
	case Excel:
		return &excelWriter{w: w, o: o, cells: base}, nil
	default:
		return &cqlWriter{w: w, o: o, cells: base, udt: udt}, nil
	}
}

// cells renders raw values for the text formats.
type cells struct {
	enc    codec.Encoder
	layout string
	cols   []exec.Column
}

// text renders column i; null reports a NULL value.
func (c *cells) text(i int, v any) (s string, null bool) {
	if v == nil {
		return "", true
	}
	td := c.cols[i].Type
	if t, ok := v.(time.Time); ok && c.layout != "" && td.Name == "timestamp" {
		return t.UTC().Format(c.layout), false
	}
	return c.enc.Text(v, td), false
}

// json renders column i in the codec JSON form.
func (c *cells) json(i int, v any) any { return c.enc.JSON(v, c.cols[i].Type) }

// strftime converts a cqlsh DATETIMEFORMAT pattern into a Go layout; "" stays "".
func strftime(p string) string {
	if p == "" {
		return ""
	}
	r := strings.NewReplacer(
		"%Y", "2006", "%m", "01", "%d", "02", "%H", "15", "%M", "04", "%S", "05",
		"%f", "000000", "%z", "-0700", "%Z", "MST", "%y", "06", "%b", "Jan", "%B", "January",
		"%a", "Mon", "%A", "Monday", "%I", "03", "%p", "PM", "%j", "002", "%%", "%",
	)
	return r.Replace(p)
}

// Strftime exposes the pattern conversion for the shell's COPY options.
func Strftime(p string) string { return strftime(p) }
