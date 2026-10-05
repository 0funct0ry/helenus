package schema

import "testing"

func TestSystemDocsParse(t *testing.T) {
	c := SystemDocs()
	if len(c.Keyspaces) < 7 {
		t.Fatalf("want 7 system keyspaces, got %d", len(c.Keyspaces))
	}
	for ks, k := range c.Keyspaces {
		if k.Description == "" {
			t.Errorf("%s: empty description", ks)
		}
		for tb, d := range k.Tables {
			if d.Description == "" {
				t.Errorf("%s.%s: empty description", ks, tb)
			}
		}
	}
	if _, ok := SystemTableDoc("system_auth", "roles"); !ok {
		t.Error("system_auth.roles missing")
	}
	if _, ok := SystemTableDoc("system", "nope"); ok {
		t.Error("unexpected doc")
	}
}

func TestMaskedColumn(t *testing.T) {
	cases := []struct {
		ks, col string
		want    bool
	}{
		{"system_auth", "salted_hash", true},
		{"system_auth", "SALTED_HASH", true},
		{"system", "db_password", true},
		{"system_auth", "role", false},
		{"shop", "salted_hash", false},
		{"shop", "password", false},
	}
	for _, c := range cases {
		if got := MaskedColumn(c.ks, c.col); got != c.want {
			t.Errorf("%s.%s = %v", c.ks, c.col, got)
		}
	}
}
