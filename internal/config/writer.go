package config

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// ErrProfileExists is returned when adding a profile whose name is taken.
var ErrProfileExists = errors.New("profile already exists")

// Writer edits the config file's YAML node tree so comments, key order and
// unrelated sections survive (SPEC §5.4). Writes are atomic with mode 0600.
type Writer struct{ Path string }

// AddProfile creates profile name from dotted-key fields ("tls.ca_cert").
func (w Writer) AddProfile(name string, fields map[string]any) error {
	return w.edit(func(profiles *yaml.Node) error {
		if findKey(profiles, name) != nil {
			return fmt.Errorf("%w: %q", ErrProfileExists, name)
		}
		node := &yaml.Node{Kind: yaml.MappingNode}
		if err := mergeFields(node, fields); err != nil {
			return err
		}
		profiles.Content = append(profiles.Content, scalar(name), node)
		return nil
	})
}

// UpdateProfile merges dotted-key fields into an existing profile. Keys not
// mentioned are untouched (so omitted secrets stay); a nil value deletes a key.
func (w Writer) UpdateProfile(name string, fields map[string]any) error {
	return w.edit(func(profiles *yaml.Node) error {
		node := findKey(profiles, name)
		if node == nil {
			return &UnknownProfileError{Name: name}
		}
		if node.Kind != yaml.MappingNode {
			*node = yaml.Node{Kind: yaml.MappingNode}
		}
		return mergeFields(node, fields)
	})
}

// RemoveProfile deletes profile name.
func (w Writer) RemoveProfile(name string) error {
	return w.edit(func(profiles *yaml.Node) error {
		for i := 0; i+1 < len(profiles.Content); i += 2 {
			if profiles.Content[i].Value == name {
				profiles.Content = append(profiles.Content[:i], profiles.Content[i+2:]...)
				return nil
			}
		}
		return &UnknownProfileError{Name: name}
	})
}

// RenameProfile renames a profile in place, keeping its position and content.
func (w Writer) RenameProfile(from, to string) error {
	return w.edit(func(profiles *yaml.Node) error {
		if findKey(profiles, to) != nil {
			return fmt.Errorf("%w: %q", ErrProfileExists, to)
		}
		for i := 0; i+1 < len(profiles.Content); i += 2 {
			if profiles.Content[i].Value == from {
				profiles.Content[i].Value = to
				return nil
			}
		}
		return &UnknownProfileError{Name: from}
	})
}

func (w Writer) edit(fn func(profiles *yaml.Node) error) error {
	var root yaml.Node
	data, err := os.ReadFile(w.Path)
	switch {
	case err == nil:
		if err := yaml.Unmarshal(data, &root); err != nil {
			return fmt.Errorf("parsing %s: %w", w.Path, err)
		}
	case errors.Is(err, os.ErrNotExist):
	default:
		return err
	}
	if root.Kind == 0 {
		root = yaml.Node{Kind: yaml.DocumentNode, Content: []*yaml.Node{{Kind: yaml.MappingNode}}}
	}
	top := root.Content[0]
	if top.Kind != yaml.MappingNode {
		return fmt.Errorf("%s: top level is not a mapping", w.Path)
	}
	profiles := findKey(top, "profiles")
	if profiles == nil || profiles.Kind != yaml.MappingNode {
		profiles = &yaml.Node{Kind: yaml.MappingNode}
		if existing := findKey(top, "profiles"); existing != nil {
			*existing = *profiles
			profiles = existing
		} else {
			top.Content = append(top.Content, scalar("profiles"), profiles)
		}
	}
	if profiles.Style&yaml.FlowStyle != 0 && len(profiles.Content) == 0 {
		profiles.Style = 0 // `profiles: {}` becomes a block mapping once it has entries
	}
	if err := fn(profiles); err != nil {
		return err
	}
	var buf bytes.Buffer
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	if err := enc.Encode(&root); err != nil {
		return err
	}
	if err := enc.Close(); err != nil {
		return err
	}
	return atomicWrite(w.Path, buf.Bytes())
}

func atomicWrite(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".config-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

func findKey(m *yaml.Node, key string) *yaml.Node {
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			return m.Content[i+1]
		}
	}
	return nil
}

func scalar(s string) *yaml.Node { return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: s} }

// fieldOrder gives new keys a readable order: SPEC §4.2.1 order first.
var fieldOrder = func() map[string]int {
	m := map[string]int{}
	for i, s := range connectionSpecs {
		if s.Key != "" {
			m[strings.SplitN(s.Key, ".", 2)[0]] = i
		}
	}
	m["password_command"] = m["password"]
	return m
}()

func mergeFields(node *yaml.Node, fields map[string]any) error {
	keys := make([]string, 0, len(fields))
	for k := range fields {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		oi, iok := fieldOrder[strings.SplitN(keys[i], ".", 2)[0]]
		oj, jok := fieldOrder[strings.SplitN(keys[j], ".", 2)[0]]
		if iok && jok && oi != oj {
			return oi < oj
		}
		return keys[i] < keys[j]
	})
	for _, k := range keys {
		if err := setPath(node, strings.Split(k, "."), fields[k]); err != nil {
			return err
		}
	}
	return nil
}

func setPath(m *yaml.Node, path []string, val any) error {
	key := path[0]
	existing := findKey(m, key)
	if len(path) > 1 {
		if existing == nil || existing.Kind != yaml.MappingNode {
			if val == nil {
				return nil
			}
			child := &yaml.Node{Kind: yaml.MappingNode}
			if existing != nil {
				*existing = *child
				child = existing
			} else {
				m.Content = append(m.Content, scalar(key), child)
			}
			existing = child
		}
		if err := setPath(existing, path[1:], val); err != nil {
			return err
		}
		if len(existing.Content) == 0 && val == nil {
			deleteKey(m, key)
		}
		return nil
	}
	if val == nil {
		deleteKey(m, key)
		return nil
	}
	var n yaml.Node
	if err := n.Encode(val); err != nil {
		return err
	}
	if _, ok := val.([]string); ok {
		n.Style = yaml.FlowStyle
	}
	if existing != nil {
		// Keep the comments attached to the old value.
		n.HeadComment, n.LineComment, n.FootComment = existing.HeadComment, existing.LineComment, existing.FootComment
		*existing = n
		return nil
	}
	m.Content = append(m.Content, scalar(key), &n)
	return nil
}

func deleteKey(m *yaml.Node, key string) {
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			m.Content = append(m.Content[:i], m.Content[i+2:]...)
			return
		}
	}
}
