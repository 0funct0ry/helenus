// Package detect finds the format of an import file and maps its columns onto
// a table's columns.
package detect

import (
	"bytes"
	"encoding/csv"
	"path/filepath"
	"strings"
)

// Formats an import file can have.
const (
	CSV    = "csv"
	JSON   = "json"
	NDJSON = "ndjson"
)

// SniffSize is how much of the file is inspected.
const SniffSize = 64 << 10

// Result is what Detect found.
type Result struct {
	Format    string `json:"format"`
	Delimiter string `json:"delimiter"`
	Quote     string `json:"quote"`
	Header    bool   `json:"header"`
}

var delimiters = []rune{',', ';', '\t', '|'}

// StripBOM removes a UTF-8 byte order mark.
func StripBOM(b []byte) []byte { return bytes.TrimPrefix(b, []byte{0xEF, 0xBB, 0xBF}) }

// Detect picks the format by extension, then by sniffing the first 64 KB of head.
func Detect(name string, head []byte) Result {
	head = StripBOM(head)
	truncated := len(head) >= SniffSize
	if truncated {
		head = head[:SniffSize]
	}
	r := Result{Format: CSV, Delimiter: ",", Quote: `"`}
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".json":
		r.Format = JSON
		if f := sniffJSON(head); f != "" {
			r.Format = f
		}
	case ".ndjson", ".jsonl":
		r.Format = NDJSON
	case ".tsv":
		r.Delimiter = "\t"
	case ".csv":
	default:
		if f := sniffJSON(head); f != "" {
			r.Format = f
		}
	}
	if r.Format != CSV {
		r.Delimiter, r.Quote = "", ""
		return r
	}
	if ext != ".tsv" {
		r.Delimiter = string(sniffDelimiter(head, truncated))
	}
	r.Header = DetectHeader(head, rune(r.Delimiter[0]))
	return r
}

// sniffJSON returns json or ndjson, or "" when the text is not JSON.
func sniffJSON(head []byte) string {
	t := bytes.TrimSpace(head)
	if len(t) == 0 {
		return ""
	}
	switch t[0] {
	case '[':
		return JSON
	case '{':
		lines := bytes.Split(t, []byte("\n"))
		if len(lines) == 1 {
			return NDJSON
		}
		// A document spanning lines starts with a line that is not a whole object.
		first := bytes.TrimSpace(lines[0])
		if first[len(first)-1] == '}' {
			return NDJSON
		}
		return JSON
	}
	return ""
}

// sniffDelimiter picks the delimiter whose field count (above one) is most
// consistent over the first 100 lines.
func sniffDelimiter(head []byte, truncated bool) rune {
	lines := firstLines(head, 100, truncated)
	best, bestScore := ',', -1.0
	for _, d := range delimiters {
		counts := map[int]int{}
		for _, l := range lines {
			counts[fieldCount(l, d)]++
		}
		modal, n := 0, 0
		for c, k := range counts {
			if k > n || (k == n && c > modal) {
				modal, n = c, k
			}
		}
		if modal < 2 {
			continue
		}
		score := float64(n)/float64(len(lines)) + float64(modal)/1000
		if score > bestScore {
			best, bestScore = d, score
		}
	}
	return best
}

func firstLines(b []byte, n int, truncated bool) []string {
	var out []string
	for _, l := range strings.Split(string(b), "\n") {
		l = strings.TrimRight(l, "\r")
		if l == "" {
			continue
		}
		out = append(out, l)
	}
	// The last line of a truncated sniff may be cut short.
	if truncated && len(out) > 1 {
		out = out[:len(out)-1]
	}
	if len(out) > n {
		out = out[:n]
	}
	return out
}

func fieldCount(line string, d rune) int {
	r := csv.NewReader(strings.NewReader(line))
	r.Comma, r.LazyQuotes, r.FieldsPerRecord = d, true, -1
	rec, err := r.Read()
	if err != nil {
		return 0
	}
	return len(rec)
}

// ReadRows parses up to n records from head; parse errors end the read.
func ReadRows(head []byte, delim rune, n int) [][]string {
	r := csv.NewReader(bytes.NewReader(StripBOM(head)))
	r.Comma, r.LazyQuotes, r.FieldsPerRecord = delim, true, -1
	var out [][]string
	for len(out) < n {
		rec, err := r.Read()
		if err != nil {
			break
		}
		out = append(out, rec)
	}
	return out
}

// DetectHeader reports whether the first row is column names: some cell is not
// parsable as the type inferred from the later rows of its column, or, for
// all-text data, the first row is non-numeric while later rows are not.
func DetectHeader(head []byte, delim rune) bool {
	rows := ReadRows(head, delim, 20)
	if len(rows) == 0 {
		return false
	}
	first, rest := rows[0], rows[1:]
	if len(rest) == 0 {
		return allText(first)
	}
	for i := range first {
		kind := ""
		for _, r := range rest {
			if i >= len(r) {
				continue
			}
			k := ValueKind(r[i])
			switch {
			case k == "":
			case kind == "":
				kind = k
			case kind != k:
				kind = "text"
			}
		}
		if kind != "" && kind != "text" && ValueKind(first[i]) != kind {
			return true
		}
	}
	return false
}

func allText(r []string) bool {
	for _, c := range r {
		if k := ValueKind(c); k != "text" {
			return false
		}
	}
	return len(r) > 0
}

// ValueKind classifies a cell as int, float, bool, uuid, date or text; empty is "".
func ValueKind(s string) string {
	s = strings.TrimSpace(s)
	switch {
	case s == "":
		return ""
	case isInt(s):
		return "int"
	case isFloat(s):
		return "float"
	case strings.EqualFold(s, "true"), strings.EqualFold(s, "false"):
		return "bool"
	case isUUID(s):
		return "uuid"
	case isDate(s):
		return "date"
	}
	return "text"
}

func isInt(s string) bool {
	s = strings.TrimPrefix(strings.TrimPrefix(s, "-"), "+")
	if s == "" {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func isFloat(s string) bool {
	dot, digits := false, false
	for i, c := range s {
		switch {
		case c >= '0' && c <= '9':
			digits = true
		case c == '.' && !dot:
			dot = true
		case (c == '-' || c == '+') && i == 0:
		default:
			return false
		}
	}
	return digits && dot
}

func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
		} else if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
			return false
		}
	}
	return true
}

func isDate(s string) bool {
	return len(s) >= 10 && s[4] == '-' && s[7] == '-' && isInt(s[:4]) && isInt(s[5:7]) && isInt(s[8:10])
}
