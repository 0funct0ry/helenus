package cli

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/cobra"

	"github.com/0funct0ry/helenus/internal/config"
)

func newCmd(t *testing.T, cfg string, args ...string) (*cobra.Command, *bytes.Buffer) {
	t.Helper()
	cmd := &cobra.Command{Use: "x", Run: func(*cobra.Command, []string) {}}
	config.AddConfigFlag(cmd)
	config.AddConnectionFlags(cmd, false)
	config.AddYesFlag(cmd)
	out := &bytes.Buffer{}
	cmd.SetOut(out)
	cmd.SetArgs(append([]string{"-c", cfg}, args...))
	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	return cmd, out
}

func TestProfileLifecycle(t *testing.T) {
	cfg := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(cfg, []byte("# my config\nprofiles: {}\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	cmd, out := newCmd(t, cfg, "-H", "10.0.0.1,10.0.0.2", "-t", "-a", "/ca.pem", "-u", "app")
	if err := ProfileAdd(cmd, out, "prod"); err != nil {
		t.Fatal(err)
	}
	if err := ProfileAdd(cmd, out, "prod"); !errors.Is(err, config.ErrProfileExists) {
		t.Fatalf("want exists error, got %v", err)
	}
	body, _ := os.ReadFile(cfg)
	if !strings.Contains(string(body), "# my config") || !strings.Contains(string(body), "ca_cert: /ca.pem") || strings.Contains(string(body), "password") {
		t.Fatalf("config:\n%s", body)
	}

	cmd, out = newCmd(t, cfg)
	out.Reset()
	if err := ProfileList(cmd, out); err != nil || !strings.Contains(out.String(), "prod") || !strings.Contains(out.String(), "10.0.0.1,10.0.0.2:9042") {
		t.Fatalf("%v\n%s", err, out)
	}

	out.Reset()
	if err := os.WriteFile(cfg, append(body, []byte("  secretp:\n    password: hunter2\n    astra:\n      token: AstraCS:abc\n")...), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := ProfileShow(cmd, out, "secretp"); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.String(), "hunter2") || strings.Contains(out.String(), "AstraCS") || strings.Count(out.String(), "********") != 2 {
		t.Fatalf("show leaked or did not mask:\n%s", out)
	}
	if err := ProfileShow(cmd, out, "nope"); Code(err) != ExitUsage {
		t.Fatalf("unknown profile code = %d (%v)", Code(err), err)
	}

	cmd, out = newCmd(t, cfg, "-y")
	if err := ProfileRemove(cmd, out, "prod"); err != nil {
		t.Fatal(err)
	}
	if err := ProfileRemove(cmd, out, "prod"); Code(err) != ExitUsage {
		t.Fatalf("code = %d", Code(err))
	}
}

func TestCodeAndHelpers(t *testing.T) {
	if Code(nil) != 1 || Code(errors.New("x")) != 1 || Code(Usagef("x")) != 2 || Code(ConnectionFailed(errors.New("x"))) != 3 {
		t.Fatal("exit codes")
	}
	pw, err := ReadPasswordStdin(strings.NewReader("s3cret\nmore"))
	if err != nil || pw != "s3cret" {
		t.Fatalf("%q %v", pw, err)
	}
	if _, err := ReadPasswordStdin(strings.NewReader("")); err == nil {
		t.Fatal("want error on empty stdin")
	}
	if !Confirm(strings.NewReader("YES\n"), &bytes.Buffer{}, "q") || Confirm(strings.NewReader("\n"), &bytes.Buffer{}, "q") {
		t.Fatal("confirm")
	}
}
