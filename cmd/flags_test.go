package cmd

import (
	"testing"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"

	"github.com/0funct0ry/helenus/internal/config"
)

// TestFlagConventions enforces SPEC §4.2 rule 5.
func TestFlagConventions(t *testing.T) {
	var walk func(c *cobra.Command)
	walk = func(c *cobra.Command) {
		c.Flags().VisitAll(func(f *pflag.Flag) {
			if f.Name == "help" {
				if f.Shorthand != "h" {
					t.Errorf("%s: --help must have -h", c.CommandPath())
				}
				return
			}
			if f.Shorthand == "" {
				t.Errorf("%s: flag --%s has no short form", c.CommandPath(), f.Name)
			}
			if f.Shorthand == "c" && f.Name != "config" {
				t.Errorf("%s: -c is reserved for --config", c.CommandPath())
			}
			spec, ok := config.Lookup(f.Name)
			if !ok {
				t.Errorf("%s: flag --%s is not in the config registry", c.CommandPath(), f.Name)
				return
			}
			if spec.Setting && spec.Key == "" {
				t.Errorf("%s: configurable flag --%s has no config key", c.CommandPath(), f.Name)
			}
			if spec.Short != f.Shorthand {
				t.Errorf("%s: flag --%s short %q differs from registry %q", c.CommandPath(), f.Name, f.Shorthand, spec.Short)
			}
		})
		c.PersistentFlags().VisitAll(func(f *pflag.Flag) {
			if f.Name != "config" || c != rootCmd {
				t.Errorf("%s: unexpected persistent flag --%s", c.CommandPath(), f.Name)
			}
		})
		for _, sub := range c.Commands() {
			walk(sub)
		}
	}
	walk(rootCmd)
}

func TestCommandTree(t *testing.T) {
	want := []string{"ui", "profile", "user", "version", "completion"}
	for _, name := range want {
		found := false
		for _, c := range rootCmd.Commands() {
			if c.Name() == name {
				found = true
			}
		}
		if !found {
			t.Errorf("missing command %q", name)
		}
	}
}
