package shell

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/0funct0ry/helenus/internal/exec"
)

func TestParseCopy(t *testing.T) {
	c, err := parseCopy(`copy Shop.Users (id, "E-Mail") TO 'out.csv' WITH HEADER=true AND DELIMITER=';' AND NULL='N/A' AND PAGESIZE=50 AND MAXOUTPUTSIZE=10 AND DATETIMEFORMAT='%Y-%m-%d';`, "ks")
	if err != nil {
		t.Fatal(err)
	}
	if c.Keyspace != "shop" || c.Table != "users" || !reflect.DeepEqual(c.Columns, []string{"id", "E-Mail"}) || c.File != "out.csv" ||
		!c.Opts.Header || c.Opts.Delimiter != ";" || c.Opts.NullString != "N/A" || c.PageSize != 50 || c.MaxOutputSize != 10 ||
		c.Opts.DateTimeFormat != "%Y-%m-%d" {
		t.Fatalf("%+v", c)
	}
	c, err = parseCopy(`COPY t TO STDOUT`, "ks")
	if err != nil || !c.Stdout || c.Keyspace != "ks" || c.PageSize != 1000 || c.Opts.Header {
		t.Fatalf("%+v %v", c, err)
	}
	for in, want := range map[string]string{
		`COPY t FROM 'x'`:                          "not supported",
		`COPY t TO`:                                "expected 'file' or STDOUT",
		`COPY t TO STDOUT WITH BOGUS=1`:            "unsupported option BOGUS",
		`COPY t TO STDOUT WITH HEADER=maybe`:       "HEADER must be",
		`COPY t TO STDOUT WITH PAGESIZE=0`:         "PAGESIZE",
		`COPY t TO STDOUT HEADER=true`:             "expected WITH",
		`COPY t TO STDOUT WITH HEADER=true NULL=1`: "separate options with AND",
		`COPY t (a TO STDOUT`:                      "column list",
		`COPY t TO STDOUT WITH MAXOUTPUTSIZE=5`:    "needs a file",
	} {
		if _, err := parseCopy(in, "ks"); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%q: %v, want %q", in, err, want)
		}
	}
	if _, err := parseCopy(`COPY t TO STDOUT`, ""); err == nil {
		t.Error("missing keyspace accepted")
	}
}

func TestCopyToStdoutPrintsOnlyRows(t *testing.T) {
	h := newHarness(func(exec.Request) (*exec.Result, error) { return rows([2]any{1, "a"}, [2]any{2, nil}), nil })
	if err := h.run("COPY shop.users (id, name) TO STDOUT WITH HEADER=true;\n"); err != nil {
		t.Fatal(err)
	}
	if h.out.String() != "id,name\n1,a\n2,\n" {
		t.Fatalf("stdout %q", h.out)
	}
	r := h.ex.reqs[0]
	if r.CQL != "SELECT id, name FROM shop.users" || r.Consistency != "LOCAL_ONE" || r.PageSize != 1000 {
		t.Fatalf("%+v", r)
	}
	if !strings.Contains(h.err.String(), "2 rows exported") {
		t.Fatalf("summary should go to stderr: %q", h.err)
	}
}

func TestCopyToFileRotatesAndCleansUp(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "o.csv")
	h := newHarness(func(exec.Request) (*exec.Result, error) {
		return rows([2]any{1, "a"}, [2]any{2, "b"}, [2]any{3, "c"}), nil
	})
	if err := h.run("COPY shop.users TO '" + target + "' WITH MAXOUTPUTSIZE=2;\n"); err != nil {
		t.Fatal(err)
	}
	a, _ := os.ReadFile(target)
	b, _ := os.ReadFile(target + ".001")
	if string(a) != "1,a\n2,b\n" || string(b) != "3,c\n" {
		t.Fatalf("files %q %q", a, b)
	}
	if !strings.Contains(h.out.String(), "3 rows exported to 2 file(s)") {
		t.Fatalf("out %q", h.out)
	}

	bad := newHarness(func(exec.Request) (*exec.Result, error) { return nil, os.ErrClosed })
	target2 := filepath.Join(dir, "bad.csv")
	if err := bad.run("COPY shop.users TO '" + target2 + "';\n"); err == nil {
		t.Fatal("expected failure")
	}
	if _, err := os.Stat(target2); !os.IsNotExist(err) {
		t.Fatalf("partial file kept: %v", err)
	}
}
