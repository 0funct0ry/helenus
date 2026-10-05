package seed

import (
	"math/rand/v2"
	"regexp/syntax"
	"strings"
)

// regexGen produces strings matching a pattern by walking its syntax tree.
// Unbounded repeats are capped, `.` draws printable ASCII, anchors are ignored.
type regexGen struct{ re *syntax.Regexp }

func newRegexGen(pattern string) (*regexGen, error) {
	re, err := syntax.Parse(pattern, syntax.Perl)
	if err != nil {
		return nil, err
	}
	return &regexGen{re: re}, nil
}

func (g *regexGen) Next(rng *rand.Rand) any {
	var b strings.Builder
	walk(g.re, rng, &b)
	s := b.String()
	if r := []rune(s); len(r) > maxRegexOutput {
		s = string(r[:maxRegexOutput])
	}
	return s
}

func printable(rng *rand.Rand) rune { return rune(0x20 + rng.IntN(0x7f-0x20)) }

func walk(re *syntax.Regexp, rng *rand.Rand, b *strings.Builder) {
	if b.Len() >= maxRegexOutput*4 {
		return
	}
	switch re.Op {
	case syntax.OpLiteral:
		for _, r := range re.Rune {
			b.WriteRune(r)
		}
	case syntax.OpCharClass:
		b.WriteRune(pickClass(re.Rune, rng))
	case syntax.OpAnyChar, syntax.OpAnyCharNotNL:
		b.WriteRune(printable(rng))
	case syntax.OpCapture:
		walk(re.Sub[0], rng, b)
	case syntax.OpConcat:
		for _, s := range re.Sub {
			walk(s, rng, b)
		}
	case syntax.OpAlternate:
		walk(re.Sub[rng.IntN(len(re.Sub))], rng, b)
	case syntax.OpQuest:
		if rng.IntN(2) == 1 {
			walk(re.Sub[0], rng, b)
		}
	case syntax.OpStar:
		repeat(re.Sub[0], rng, b, 0, maxRegexRepeat)
	case syntax.OpPlus:
		repeat(re.Sub[0], rng, b, 1, maxRegexRepeat)
	case syntax.OpRepeat:
		hi := re.Max
		if hi < 0 {
			hi = max(re.Min, maxRegexRepeat)
		}
		repeat(re.Sub[0], rng, b, re.Min, hi)
	}
	// Empty matches, anchors and word boundaries add no text.
}

func repeat(sub *syntax.Regexp, rng *rand.Rand, b *strings.Builder, lo, hi int) {
	n := lo
	if hi > lo {
		n += rng.IntN(hi - lo + 1)
	}
	for i := 0; i < n; i++ {
		walk(sub, rng, b)
	}
}

// pickClass picks uniformly from the printable-ASCII part of a class, or from
// the class itself when it has none.
func pickClass(ranges []rune, rng *rand.Rand) rune {
	var clipped []rune
	total := 0
	for i := 0; i+1 < len(ranges); i += 2 {
		lo, hi := max(ranges[i], 0x20), min(ranges[i+1], 0x7e)
		if lo <= hi {
			clipped = append(clipped, lo, hi)
			total += int(hi-lo) + 1
		}
	}
	if total == 0 {
		if len(ranges) < 2 {
			return 'a'
		}
		return ranges[0] + rune(rng.IntN(int(ranges[1]-ranges[0])+1))
	}
	n := rng.IntN(total)
	for i := 0; i < len(clipped); i += 2 {
		size := int(clipped[i+1]-clipped[i]) + 1
		if n < size {
			return clipped[i] + rune(n)
		}
		n -= size
	}
	return 'a'
}
