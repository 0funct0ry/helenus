package cql

import (
	"strings"

	"github.com/0funct0ry/helenus/internal/codec"
)

// RenderLiteral renders a driver value as a CQL literal. It is used for
// previews and DESCRIBE output only; execution binds values (SPEC §7.2).
func RenderLiteral(v any, td codec.TypeDesc) string {
	return RenderLiteralUDT(v, td, nil)
}

// RenderLiteralUDT is RenderLiteral with a resolver for user-defined type
// fields, so UDT fields are quoted by their declared type.
func RenderLiteralUDT(v any, td codec.TypeDesc, udt func(codec.UDTRef) map[string]codec.TypeDesc) string {
	enc := codec.Encoder{UDTFields: udt}
	s := enc.Text(v, td)
	if v == nil {
		return "null"
	}
	switch strings.ToLower(td.Name) {
	case "text", "varchar", "ascii":
		return QuoteString(s)
	case "timestamp", "date", "time", "inet", "duration":
		if td.Name == "duration" {
			return s
		}
		return QuoteString(s)
	}
	return s
}
