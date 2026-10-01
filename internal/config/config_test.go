package config

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/spf13/cobra"
)

func newCmd(args ...string) *cobra.Command {
	cmd := &cobra.Command{Use: "x", Run: func(*cobra.Command, []string) {}}
	AddConfigFlag(cmd)
	AddUIFlags(cmd)
	cmd.SetArgs(args)
	_ = cmd.Execute()
	return cmd
}

func writeConfig(t *testing.T, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestPrecedence(t *testing.T) {
	cfg := writeConfig(t, "ui:\n  addr: 1.1.1.1:1\n")

	t.Run("default", func(t *testing.T) {
		t.Setenv("HELENUS_CONFIG", filepath.Join(t.TempDir(), "none.yaml"))
		t.Setenv("XDG_CONFIG_HOME", t.TempDir())
		os.Unsetenv("HELENUS_CONFIG")
		s, err := Resolve(newCmd())
		if err != nil {
			t.Fatal(err)
		}
		if got := s.V.GetString("ui.addr"); got != "127.0.0.1:4042" {
			t.Fatalf("got %q", got)
		}
	})
	t.Run("file", func(t *testing.T) {
		s, err := Resolve(newCmd("-c", cfg))
		if err != nil {
			t.Fatal(err)
		}
		if got := s.V.GetString("ui.addr"); got != "1.1.1.1:1" {
			t.Fatalf("got %q", got)
		}
	})
	t.Run("env beats file", func(t *testing.T) {
		t.Setenv("HELENUS_ADDR", "2.2.2.2:2")
		s, err := Resolve(newCmd("-c", cfg))
		if err != nil {
			t.Fatal(err)
		}
		if got := s.V.GetString("ui.addr"); got != "2.2.2.2:2" {
			t.Fatalf("got %q", got)
		}
		if s.Config.UI.Addr != "2.2.2.2:2" {
			t.Fatalf("struct got %q", s.Config.UI.Addr)
		}
	})
	t.Run("flag beats env", func(t *testing.T) {
		t.Setenv("HELENUS_ADDR", "2.2.2.2:2")
		s, err := Resolve(newCmd("-c", cfg, "-a", "3.3.3.3:3"))
		if err != nil {
			t.Fatal(err)
		}
		if got := s.V.GetString("ui.addr"); got != "3.3.3.3:3" {
			t.Fatalf("got %q", got)
		}
	})
	t.Run("config path from env", func(t *testing.T) {
		t.Setenv("HELENUS_CONFIG", cfg)
		s, err := Resolve(newCmd())
		if err != nil {
			t.Fatal(err)
		}
		if s.Path != cfg {
			t.Fatalf("path %q", s.Path)
		}
	})
	t.Run("missing explicit config is an error", func(t *testing.T) {
		if _, err := Resolve(newCmd("-c", filepath.Join(t.TempDir(), "nope.yaml"))); err == nil {
			t.Fatal("expected error")
		}
	})
}

func TestLocalFlagsDoNotShareState(t *testing.T) {
	a := &cobra.Command{Use: "a", Run: func(*cobra.Command, []string) {}}
	b := &cobra.Command{Use: "b", Run: func(*cobra.Command, []string) {}}
	for _, c := range []*cobra.Command{a, b} {
		AddConfigFlag(c)
		AddDBFlag(c)
	}
	a.SetArgs([]string{"-D", "a.db"})
	_ = a.Execute()
	b.SetArgs(nil)
	_ = b.Execute()
	sa, _ := Resolve(a)
	sb, _ := Resolve(b)
	if sa.V.GetString("paths.db") != "a.db" || sb.V.GetString("paths.db") != "" {
		t.Fatalf("a=%q b=%q", sa.V.GetString("paths.db"), sb.V.GetString("paths.db"))
	}
}

func TestProfileSelectionAndHostList(t *testing.T) {
	cfg := writeConfig(t, "profiles:\n  default:\n    port: 9999\n    hosts: [a, b]\n  prod:\n    port: 1234\n")
	cmd := &cobra.Command{Use: "x", Run: func(*cobra.Command, []string) {}}
	AddConfigFlag(cmd)
	AddConnectionFlags(cmd, true)
	cmd.SetArgs([]string{"-c", cfg, "-P", "prod"})
	_ = cmd.Execute()
	s, err := Resolve(cmd)
	if err != nil {
		t.Fatal(err)
	}
	if s.Profile != "prod" || s.V.GetInt("port") != 1234 {
		t.Fatalf("profile %q port %d", s.Profile, s.V.GetInt("port"))
	}
	t.Setenv("HELENUS_HOSTS", "x,y")
	s, _ = Resolve(cmd)
	if got := StringList(s.V, "hosts"); len(got) != 2 || got[0] != "x" {
		t.Fatalf("hosts %v", got)
	}
}
