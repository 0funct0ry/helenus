package schema

import (
	_ "embed"
	"encoding/json"
	"sync"
)

//go:embed systemdocs.json
var systemDocsJSON []byte

// TableDoc describes one system table for beginners.
type TableDoc struct {
	Description string            `json:"description"`
	Columns     map[string]string `json:"columns,omitempty"`
}

// KeyspaceDoc describes one system keyspace and its tables.
type KeyspaceDoc struct {
	Description string              `json:"description"`
	Tables      map[string]TableDoc `json:"tables"`
}

// SystemDocCatalog is the embedded catalog of system keyspace descriptions.
type SystemDocCatalog struct {
	Keyspaces map[string]KeyspaceDoc `json:"keyspaces"`
}

var (
	sysDocsOnce sync.Once
	sysDocs     SystemDocCatalog
)

// SystemDocs returns the embedded catalog of system keyspace and table descriptions.
func SystemDocs() SystemDocCatalog {
	sysDocsOnce.Do(func() {
		if err := json.Unmarshal(systemDocsJSON, &sysDocs); err != nil {
			panic("systemdocs.json: " + err.Error())
		}
	})
	return sysDocs
}

// SystemTableDoc returns the description of keyspace.table, if cataloged.
func SystemTableDoc(keyspace, table string) (TableDoc, bool) {
	d, ok := SystemDocs().Keyspaces[keyspace].Tables[table]
	return d, ok
}
