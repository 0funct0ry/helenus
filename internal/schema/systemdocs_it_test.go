//go:build integration

package schema

import (
	"context"
	"testing"
)

// Every table in the system keyspaces (real and virtual) must have a catalog entry.
func TestSystemDocsCoverage(t *testing.T) {
	s := session(t)
	snap, err := Build(context.Background(), s)
	if err != nil {
		t.Fatal(err)
	}
	for _, ks := range snap.Keyspaces {
		if !ks.System {
			continue
		}
		for _, tb := range ks.Tables {
			if _, ok := SystemTableDoc(ks.Name, tb.Name); !ok {
				t.Errorf("no catalog entry for %s.%s", ks.Name, tb.Name)
			}
		}
	}
}
