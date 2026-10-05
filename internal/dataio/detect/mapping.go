package detect

import (
	"strings"
	"unicode"
)

// Confidence labels of an automatic mapping.
const (
	Exact      = "exact"
	Case       = "case"
	Normalized = "normalized"
	Fuzzy      = "fuzzy"
)

// Match is one source column assigned to one target column.
type Match struct {
	Target     string `json:"target"`
	Source     string `json:"source"`
	Confidence string `json:"confidence"`
}

// Normalize lowercases a name and drops _ - and spaces, which also folds
// camelCase onto snake_case.
func Normalize(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r == '_' || r == '-' || unicode.IsSpace(r) {
			continue
		}
		b.WriteRune(unicode.ToLower(r))
	}
	return b.String()
}

// Levenshtein is the edit distance between a and b.
func Levenshtein(a, b string) int {
	ra, rb := []rune(a), []rune(b)
	prev := make([]int, len(rb)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(ra); i++ {
		cur := make([]int, len(rb)+1)
		cur[0] = i
		for j := 1; j <= len(rb); j++ {
			cost := 1
			if ra[i-1] == rb[j-1] {
				cost = 0
			}
			cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost)
		}
		prev = cur
	}
	return prev[len(rb)]
}

// Auto maps each source column to at most one target column. Passes run in
// order (exact, case-insensitive, normalized, fuzzy with distance ≤ 2) and a
// source taken by an earlier pass is not reused. The result follows target
// order and lists only the targets that found a source.
func Auto(source, target []string) []Match {
	srcUsed := make([]bool, len(source))
	got := map[string]Match{}
	pass := func(label string, eq func(s, t string) bool) {
		for _, t := range target {
			if _, done := got[t]; done {
				continue
			}
			best, bestD := -1, 1<<30
			for i, s := range source {
				if srcUsed[i] || !eq(s, t) {
					continue
				}
				if d := Levenshtein(Normalize(s), Normalize(t)); d < bestD {
					best, bestD = i, d
				}
			}
			if best >= 0 {
				srcUsed[best] = true
				got[t] = Match{Target: t, Source: source[best], Confidence: label}
			}
		}
	}
	pass(Exact, func(s, t string) bool { return s == t })
	pass(Case, func(s, t string) bool { return strings.EqualFold(s, t) })
	pass(Normalized, func(s, t string) bool { return Normalize(s) == Normalize(t) })
	pass(Fuzzy, func(s, t string) bool { return Levenshtein(Normalize(s), Normalize(t)) <= 2 })
	var out []Match
	for _, t := range target {
		if m, ok := got[t]; ok {
			out = append(out, m)
		}
	}
	return out
}

// Label says how well source matches target: exact, case, normalized, fuzzy or
// manual when the names are unrelated (a mapping the user chose).
func Label(source, target string) string {
	switch {
	case source == target:
		return Exact
	case strings.EqualFold(source, target):
		return Case
	case Normalize(source) == Normalize(target):
		return Normalized
	case Levenshtein(Normalize(source), Normalize(target)) <= 2:
		return Fuzzy
	}
	return "manual"
}
