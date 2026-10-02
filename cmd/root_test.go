package cmd

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/0funct0ry/helenus/internal/config"
)

func TestShellOptionsResolution(t *testing.T) {
	cfg := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(cfg, []byte("shell: {}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HELENUS_CONFIG", cfg)
	t.Setenv("HELENUS_PAGING", "25")
	s, err := config.Resolve(rootCmd)
	if err != nil {
		t.Fatal(err)
	}
	o, err := shellOptions(s)
	if err != nil {
		t.Fatal(err)
	}
	if o.format != "table" || o.paging != 25 || o.historySize != 10000 || o.history == "" {
		t.Errorf("options = %+v", o)
	}

	t.Setenv("HELENUS_FORMAT", "xml")
	s, _ = config.Resolve(rootCmd)
	if _, err := shellOptions(s); err == nil {
		t.Error("format xml accepted")
	}
	t.Setenv("HELENUS_FORMAT", "RAW")
	s, _ = config.Resolve(rootCmd)
	if o, err := shellOptions(s); err != nil || o.format != "raw" {
		t.Errorf("format = %q err = %v", o.format, err)
	}
}
