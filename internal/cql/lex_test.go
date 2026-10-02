package cql

import "testing"

func TestTokenize(t *testing.T) {
	toks := Tokenize(`SELECT "Mixed""Case", 1.5 FROM ks.t -- note
WHERE a = 'it''s' /* c */ AND b = $$x$$;`)
	var got []string
	for _, tk := range toks {
		got = append(got, tk.Text)
	}
	want := []string{"SELECT", `"Mixed""Case"`, ",", "1.5", "FROM", "ks", ".", "t", "WHERE", "a", "=", "'it''s'", "AND", "b", "=", "$$x$$", ";"}
	if len(got) != len(want) {
		t.Fatalf("got %q", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("token %d = %q, want %q", i, got[i], want[i])
		}
	}
	if toks[1].Kind != TokQIdent || toks[1].Ident() != `Mixed"Case` || toks[0].Ident() != "select" || toks[3].Kind != TokNumber {
		t.Errorf("kinds/idents wrong: %+v", toks[:4])
	}
}

func TestTokenizeOpenQuotes(t *testing.T) {
	for _, in := range []string{`"abc`, `'abc`, `$$abc`} {
		toks := Tokenize(in)
		if len(toks) != 1 || !toks[0].Open || toks[0].End != len(in) {
			t.Errorf("%q: %+v", in, toks)
		}
	}
	if got := Tokenize(`"abc`)[0].Ident(); got != "abc" {
		t.Errorf("open ident = %q", got)
	}
	if len(Tokenize("/* never closed")) != 0 {
		t.Error("an unterminated comment produces no tokens")
	}
}
