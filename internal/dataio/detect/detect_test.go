package detect

import (
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

var update = flag.Bool("update", false, "rewrite golden files")

func TestDetectGolden(t *testing.T) {
	files, _ := filepath.Glob("testdata/*")
	got := map[string]Result{}
	for _, f := range files {
		if filepath.Base(f) == "golden.json" {
			continue
		}
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		got[filepath.Base(f)] = Detect(f, b)
	}
	out, _ := json.MarshalIndent(got, "", "  ")
	golden := "testdata/golden.json"
	if *update {
		if err := os.WriteFile(golden, append(out, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(golden)
	if err != nil {
		t.Fatal(err)
	}
	var w map[string]Result
	_ = json.Unmarshal(want, &w)
	if !reflect.DeepEqual(got, w) {
		t.Fatalf("detection changed; run make golden-dataio\n got: %s\nwant: %s", out, want)
	}
}

func TestDetectInvariants(t *testing.T) {
	r := Detect("semi.csv", []byte("UserId;E-Mail;createdAt\n1;a@x.com;2024-01-01\n"))
	if r.Delimiter != ";" || !r.Header {
		t.Fatalf("%+v", r)
	}
	if r := Detect("x.txt", []byte("[{\"a\":1}]")); r.Format != JSON {
		t.Fatalf("%+v", r)
	}
	if r := Detect("x.csv", []byte("1,a\n2,b\n")); r.Header {
		t.Fatalf("data row taken for a header: %+v", r)
	}
	// A sniff cut mid-line must not flip the delimiter.
	big := []byte{}
	for len(big) < SniffSize+50 {
		big = append(big, "1;ann;x,y\n"...)
	}
	if r := Detect("big.csv", big); r.Delimiter != ";" {
		t.Fatalf("%+v", r)
	}
}

func TestAutoMapping(t *testing.T) {
	got := Auto([]string{"UserId", "E-Mail", "createdAt", "extra"}, []string{"user_id", "email", "created_at", "name"})
	want := []Match{
		{"user_id", "UserId", Normalized}, {"email", "E-Mail", Normalized}, {"created_at", "createdAt", Normalized},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%+v", got)
	}
	got = Auto([]string{"ID", "emial", "name"}, []string{"id", "email", "name"})
	want = []Match{{"id", "ID", Case}, {"email", "emial", Fuzzy}, {"name", "name", Exact}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%+v", got)
	}
	// One source feeds at most one target: the exact match wins it.
	got = Auto([]string{"id"}, []string{"id", "ib"})
	if len(got) != 1 || got[0].Target != "id" {
		t.Fatalf("%+v", got)
	}
	if Levenshtein("kitten", "sitting") != 3 || Label("a", "zzzz") != "manual" {
		t.Fatal("distance or label")
	}
}
