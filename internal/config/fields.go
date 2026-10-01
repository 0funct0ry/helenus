package config

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/spf13/viper"
	"gopkg.in/yaml.v3"
)

// ApplyFields returns base with dotted-key fields ("tls.ca_cert") applied; a
// nil value clears the key. Used to test unsaved or edited profiles.
func ApplyFields(base Profile, fields map[string]any) (Profile, error) {
	raw, err := yaml.Marshal(base)
	if err != nil {
		return base, err
	}
	tree := map[string]any{}
	if err := yaml.Unmarshal(raw, &tree); err != nil {
		return base, err
	}
	for k, val := range fields {
		setNested(tree, strings.Split(k, "."), val)
	}
	merged, err := yaml.Marshal(tree)
	if err != nil {
		return base, err
	}
	v := viper.New()
	v.SetConfigType("yaml")
	if err := v.ReadConfig(bytes.NewReader(merged)); err != nil {
		return base, fmt.Errorf("applying fields: %w", err)
	}
	p, err := ProfileFromViper(v, base.Name)
	if err != nil {
		return base, err
	}
	p.ApplyDefaults()
	return p, nil
}

func setNested(m map[string]any, path []string, val any) {
	if len(path) == 1 {
		if val == nil {
			delete(m, path[0])
		} else {
			m[path[0]] = val
		}
		return
	}
	child, _ := m[path[0]].(map[string]any)
	if child == nil {
		child = map[string]any{}
		m[path[0]] = child
	}
	setNested(child, path[1:], val)
}
