package codec

import (
	"bytes"
	"encoding/json"
)

// jsonNumber is a float rendered with the shortest representation that round-trips.
type jsonNumber string

// MarshalJSON writes the number unquoted.
func (n jsonNumber) MarshalJSON() ([]byte, error) { return []byte(n), nil }

// OrderedObject is a JSON object that keeps its key order (UDT fields).
type OrderedObject struct {
	Keys   []string
	Values map[string]any
	// types holds the field types when the encoder could resolve them, so the
	// text renderer can quote each field correctly.
	types map[string]TypeDesc
}

// MarshalJSON writes the object with keys in order.
func (o *OrderedObject) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, k := range o.Keys {
		if i > 0 {
			b.WriteByte(',')
		}
		kb, _ := json.Marshal(k)
		vb, err := json.Marshal(o.Values[k])
		if err != nil {
			return nil, err
		}
		b.Write(kb)
		b.WriteByte(':')
		b.Write(vb)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}
