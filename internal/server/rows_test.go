package server

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/schema"
)

const rowsCols = `[{"name":"id","type":{"name":"int"},"kind":"partition","position":1},{"name":"name","type":{"name":"text"},"kind":"regular"}]`

func TestRowsFormat(t *testing.T) {
	e := newEnv(t, seed)
	body := `{"format":"csv","columns":` + rowsCols + `,"rows":[[1,"a"],[2,null]]}`
	rec := e.do("POST", "/api/v1/p/local/rows/format", body)
	require.Equal(t, 200, rec.Code, rec.Body.String())
	var out struct{ Text string }
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	require.Equal(t, "id,name\n1,a\n2,", out.Text)

	rec = e.do("POST", "/api/v1/p/local/rows/format", `{"format":"where","source":null,"columns":`+rowsCols+`,"rows":[[1,"a"]]}`)
	require.Equal(t, 422, rec.Code)
	require.Contains(t, rec.Body.String(), "format_unavailable")

	rec = e.do("POST", "/api/v1/p/local/rows/format", `{"format":"bogus","columns":[],"rows":[]}`)
	require.Equal(t, 400, rec.Code)
	rec = e.do("POST", "/api/v1/p/local/rows/format", `{`)
	require.Equal(t, 400, rec.Code)
}

func TestRowsAggregate(t *testing.T) {
	e := newEnv(t, seed)
	rec := e.do("POST", "/api/v1/p/local/rows/aggregate", `{"columns":`+rowsCols+`,"rows":[[1,"a"],[3,null]]}`)
	require.Equal(t, 200, rec.Code, rec.Body.String())
	require.Contains(t, rec.Body.String(), "SUM: 4")
	require.Contains(t, rec.Body.String(), "ROWS: 2")
}

func TestRowsFormatResolvesUDTFromSchema(t *testing.T) {
	e := changesEnv(t) // connected, with a schema snapshot
	cols := `[{"name":"id","type":{"name":"int"},"kind":"partition","position":1},{"name":"addr","type":{"name":"address","frozen":true,"udt":{"keyspace":"payments","name":"address"}}}]`
	body := `{"format":"csv","columns":` + cols + `,"rows":[[1,{"city":"x"}]]}`

	// The type is not in the snapshot yet, so the cell cannot be decoded.
	rec := e.do("POST", "/api/v1/p/local/rows/format", body)
	require.Equal(t, 422, rec.Code)
	require.Contains(t, rec.Body.String(), "unknown user-defined type")

	e.fc.snap.Keyspaces[0].Types = []schema.UDT{{Keyspace: "payments", Name: "address", Fields: []schema.Field{{Name: "city", Type: codec.TypeDesc{Name: "text"}}}}}
	rec = e.do("POST", "/api/v1/p/local/rows/format", body)
	require.Equal(t, 200, rec.Code, rec.Body.String())
	require.Contains(t, rec.Body.String(), "city")
	rec = e.do("POST", "/api/v1/p/local/rows/aggregate", `{"columns":`+cols+`,"rows":[[1,{"city":"x"}]]}`)
	require.Equal(t, 200, rec.Code, rec.Body.String())
}
