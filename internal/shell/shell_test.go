package shell

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/0funct0ry/helenus/internal/conn"
	"github.com/0funct0ry/helenus/internal/schema"
)

type fakeDescriber struct {
	got []schema.Target
	ks  string
	err error
}

func (f *fakeDescriber) Describe(_ context.Context, t schema.Target, ks string) (string, error) {
	f.got, f.ks = append(f.got, t), ks
	return "DDL for " + t.Name + "\n", f.err
}

func run(t *testing.T, d *fakeDescriber, input string) (out, errOut string) {
	t.Helper()
	var o, e bytes.Buffer
	s := &Shell{
		In: strings.NewReader(input), Out: &o, Err: &e, Describer: d, Version: "1.2.3", Host: "10.0.0.1", Port: 9042, Keyspace: "payments",
		Cluster: &conn.ClusterInfo{Name: "Test Cluster", ReleaseVersion: "5.0.2", CQLVersion: "3.4.7", ProtocolVersion: "5"},
	}
	s.Run(context.Background())
	return o.String(), e.String()
}

func TestDescribeForms(t *testing.T) {
	d := &fakeDescriber{}
	out, errOut := run(t, d, "DESCRIBE TABLE payments.merchants;\ndesc keyspaces\nEXIT\n")
	if errOut != "" || !strings.Contains(out, "DDL for merchants") {
		t.Fatalf("out=%q err=%q", out, errOut)
	}
	if len(d.got) != 2 || d.got[0].Kind != schema.TableT || d.got[1].Kind != schema.Keyspaces {
		t.Errorf("targets = %+v", d.got)
	}
	if d.ks != "payments" {
		t.Errorf("current keyspace not passed: %q", d.ks)
	}
}

func TestDescribeErrorsGoToStderr(t *testing.T) {
	_, errOut := run(t, &fakeDescriber{}, "DESCRIBE\nQUIT\n")
	if !strings.Contains(errOut, "SyntaxError") {
		t.Errorf("err = %q", errOut)
	}
	_, errOut = run(t, &fakeDescriber{err: errors.New("boom")}, "DESCRIBE TABLES\nQUIT\n")
	if !strings.Contains(errOut, "Error: boom") {
		t.Errorf("err = %q", errOut)
	}
}

func TestShow(t *testing.T) {
	out, errOut := run(t, &fakeDescriber{}, "SHOW VERSION\nSHOW HOST;\nSHOW NOPE\n")
	for _, want := range []string{"[helenus 1.2.3 | Cassandra 5.0.2 | CQL spec 3.4.7 | Native protocol v5]", "Connected to Test Cluster at 10.0.0.1:9042"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in %q", want, out)
		}
	}
	if !strings.Contains(errOut, "SHOW supports") {
		t.Errorf("err = %q", errOut)
	}
}

func TestOtherStatementsAreNotYetSupported(t *testing.T) {
	out, _ := run(t, &fakeDescriber{}, "SELECT 1;\n")
	if !strings.Contains(out, "not implemented yet") {
		t.Errorf("out = %q", out)
	}
}
