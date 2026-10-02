package codec

import "testing"

func TestParseRoundTrip(t *testing.T) {
	for _, in := range []string{
		"uuid",
		"frozen<address>",
		"list<decimal>",
		"map<text, frozen<address>>",
		"map<text, frozen<list<frozen<tuple<int, text>>>>>",
		"frozen<tuple<double, double>>",
		"vector<float, 3>",
		"set<frozen<map<text, int>>>",
		`frozen<"MixedCase">`,
	} {
		d, err := Parse(in, "ks")
		if err != nil {
			t.Fatalf("Parse(%q): %v", in, err)
		}
		if got := d.String(); got != in {
			t.Errorf("round trip %q -> %q", in, got)
		}
	}
}

func TestParseShape(t *testing.T) {
	d, err := Parse("map<text, frozen<address>>", "payments")
	if err != nil {
		t.Fatal(err)
	}
	v := d.Args[1]
	if d.Name != "map" || !v.Frozen || v.UDT == nil || v.UDT.Keyspace != "payments" || v.UDT.Name != "address" {
		t.Errorf("unexpected %+v", d)
	}
	vec, _ := Parse("vector<float, 128>", "ks")
	if vec.Size != 128 || vec.Args[0].Name != "float" {
		t.Errorf("vector %+v", vec)
	}
}

func TestParseErrors(t *testing.T) {
	for _, in := range []string{"", "list<", "map<text>x", "frozen<a, b>", "vector<float>"} {
		if _, err := Parse(in, "ks"); err == nil {
			t.Errorf("Parse(%q) should fail", in)
		}
	}
}
