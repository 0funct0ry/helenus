package cmd

import (
	"bytes"
	"path/filepath"
	"strings"
	"testing"
)

func runUser(t *testing.T, stdin string, args ...string) (string, error) {
	t.Helper()
	var out bytes.Buffer
	rootCmd.SetOut(&out)
	rootCmd.SetErr(&out)
	rootCmd.SetIn(strings.NewReader(stdin))
	rootCmd.SetArgs(append([]string{"user"}, args...))
	err := rootCmd.Execute()
	return out.String(), err
}

func TestUserCommands(t *testing.T) {
	db := filepath.Join(t.TempDir(), "h.db")
	if _, err := runUser(t, "short\n", "add", "alice", "-s", "-D", db); err == nil {
		t.Fatal("short password accepted")
	}
	if out, err := runUser(t, "correct horse battery\n", "add", "alice", "-s", "-D", db); err != nil || !strings.Contains(out, `Created user "alice"`) {
		t.Fatalf("add: %v %s", err, out)
	}
	if _, err := runUser(t, "correct horse battery\n", "add", "Alice", "-s", "-D", db); err == nil {
		t.Fatal("duplicate accepted")
	}
	if out, _ := runUser(t, "", "list", "-D", db); !strings.Contains(out, "alice") || !strings.Contains(out, "never") {
		t.Fatalf("list: %s", out)
	}
	if out, err := runUser(t, "another long passphrase\n", "passwd", "alice", "-s", "-D", db); err != nil || !strings.Contains(out, "signed them out") {
		t.Fatalf("passwd: %v %s", err, out)
	}
	if _, err := runUser(t, "n\n", "remove", "alice", "-D", db); err == nil {
		t.Fatal("remove without confirmation succeeded")
	}
	if _, err := runUser(t, "", "remove", "alice", "-y", "-D", db); err != nil {
		t.Fatal(err)
	}
	if _, err := runUser(t, "", "remove", "alice", "-y", "-D", db); err == nil {
		t.Fatal("removing a missing user succeeded")
	}
}
