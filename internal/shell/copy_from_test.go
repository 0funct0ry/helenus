package shell

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/exec"
	"github.com/0funct0ry/helenus/internal/schema"
)

func usersSnapshot() *schema.Snapshot {
	td := func(s string) codec.TypeDesc { d, _ := codec.Parse(s, "shop"); return d }
	return &schema.Snapshot{Keyspaces: []schema.Keyspace{{Name: "shop", Tables: []schema.Table{{
		Keyspace: "shop", Name: "users", Columns: []schema.Column{
			{Name: "email", Type: td("text"), Kind: schema.KindRegular},
			{Name: "id", Type: td("int"), Kind: schema.KindPartition, Position: 1},
		}}}}}}
}

func TestParseCopyFrom(t *testing.T) {
	c, err := parseCopy(`COPY shop.users (id, email) FROM 'in.csv' WITH HEADER=true AND MAXERRORS=7 AND MAXBATCHSIZE=20 AND CHUNKSIZE=100 AND ERRFILE='bad.err' AND NULL='-'`, "")
	if err != nil || !c.From || c.Stdin || c.File != "in.csv" || !c.Opts.Header || c.MaxErrors != 7 || c.MaxBatchSize != 20 || c.ErrFile != "bad.err" || c.Opts.NullString != "-" {
		t.Fatalf("%+v %v", c, err)
	}
	if c, err = parseCopy(`copy t from stdin`, "ks"); err != nil || !c.Stdin || c.File != "" {
		t.Fatalf("%+v %v", c, err)
	}
}

func fromHarness(t *testing.T, input string) (*harness, *[]exec.Request) {
	t.Helper()
	var reqs []exec.Request
	h := newHarness(func(r exec.Request) (*exec.Result, error) { reqs = append(reqs, r); return &exec.Result{}, nil })
	h.sh.In = strings.NewReader(input)
	h.sh.Schema = func(context.Context) (*schema.Snapshot, error) { return usersSnapshot(), nil }
	return h, &reqs
}

func TestCopyFromStdinMapsByPositionAndKeepsStdoutClean(t *testing.T) {
	h, reqs := fromHarness(t, "id,email\n1,a@x.com\n2,b@x.com\n")
	if err := h.run("COPY shop.users FROM STDIN WITH HEADER=true\n"); err != nil {
		t.Fatal(err)
	}
	if h.out.Len() != 0 || !strings.Contains(h.err.String(), "2 rows imported") {
		t.Fatalf("out=%q err=%q", h.out, h.err)
	}
	// No column list: the primary key comes first, whatever the table's column order.
	if len(*reqs) != 2 || (*reqs)[0].CQL != "INSERT INTO shop.users (id, email) VALUES (?, ?)" || (*reqs)[0].Args[0] != int32(1) {
		t.Fatalf("%+v", *reqs)
	}
}

func TestCopyFromFileWritesErrFileOnlyWhenRowsFail(t *testing.T) {
	dir := t.TempDir()
	in, bad := filepath.Join(dir, "in.csv"), filepath.Join(dir, "bad.err")
	_ = os.WriteFile(in, []byte("1,a@x.com\nx,b@x.com\n"), 0o600)
	h, _ := fromHarness(t, "")
	if err := h.run("COPY shop.users (id, email) FROM '" + in + "' WITH ERRFILE='" + bad + "';\n"); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(bad)
	if !strings.Contains(string(b), "2,id,x,int: expected an integer") || !strings.Contains(h.err.String(), "1 rejected") {
		t.Fatalf("errfile %q err %q", b, h.err)
	}
	clean := filepath.Join(dir, "none.err")
	_ = os.WriteFile(in, []byte("1,a@x.com\n"), 0o600)
	if err := h.run("COPY shop.users (id, email) FROM '" + in + "' WITH ERRFILE='" + clean + "';\n"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(clean); !os.IsNotExist(err) {
		t.Fatalf("empty error file left: %v", err)
	}
}

func TestCopyFromRefusals(t *testing.T) {
	h, _ := fromHarness(t, "1,a\n")
	for script, want := range map[string]string{
		"COPY shop.nope FROM STDIN;\n":                     "does not exist",
		"COPY shop.users (id, zzz) FROM STDIN;\n":          "no column zzz",
		"COPY shop.users (id) FROM '/no/such/file.csv';\n": "no such file",
		"COPY shop.users (email) FROM STDIN;\n":            "2 fields per row but 1 columns",
	} {
		h.err.Reset()
		h.sh.In = strings.NewReader("1,a\n")
		_ = h.run(script)
		if !strings.Contains(h.err.String(), want) {
			t.Errorf("%q: %q, want %q", script, h.err, want)
		}
	}
}
