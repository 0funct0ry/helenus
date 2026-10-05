package seed

import (
	"embed"
	"fmt"
	"math/rand/v2"
	"strings"
	"sync"
	"time"
)

//go:embed data/*.txt
var dataFS embed.FS

var (
	listsOnce sync.Once
	lists     map[string][]string
)

func list(name string) []string {
	listsOnce.Do(func() {
		lists = map[string][]string{}
		entries, _ := dataFS.ReadDir("data")
		for _, e := range entries {
			b, _ := dataFS.ReadFile("data/" + e.Name())
			var out []string
			for _, l := range strings.Split(string(b), "\n") {
				if l = strings.TrimSpace(l); l != "" {
					out = append(out, l)
				}
			}
			lists[strings.TrimSuffix(e.Name(), ".txt")] = out
		}
	})
	return lists[name]
}

func pick(rng *rand.Rand, name string) string {
	l := list(name)
	return l[rng.IntN(len(l))]
}

// FakeCategories are the values of the fake generator's category parameter.
var FakeCategories = []string{
	"first_name", "last_name", "full_name", "email", "username", "phone", "company", "job_title", "street",
	"city", "state", "country", "zip", "url", "ipv4", "ipv6", "word", "sentence", "paragraph", "color",
	"product", "birthdate",
}

var emailDomains = []string{"example.com", "example.org", "example.net"}

func lower(s string) string {
	return strings.ToLower(strings.NewReplacer(" ", "", "'", "", "-", "").Replace(s))
}

func ipv4(rng *rand.Rand) string {
	first := 1 + rng.IntN(223)
	for first == 127 || first == 10 {
		first = 1 + rng.IntN(223)
	}
	return fmt.Sprintf("%d.%d.%d.%d", first, rng.IntN(256), rng.IntN(256), 1+rng.IntN(254))
}

func ipv6(rng *rand.Rand) string {
	g := make([]string, 8)
	g[0] = "2001"
	for i := 1; i < 8; i++ {
		g[i] = fmt.Sprintf("%x", rng.IntN(65536))
	}
	return strings.Join(g, ":")
}

func sentence(rng *rand.Rand) string {
	n := 5 + rng.IntN(8)
	w := make([]string, n)
	for i := range w {
		w[i] = pick(rng, "words")
	}
	s := strings.Join(w, " ")
	return strings.ToUpper(s[:1]) + s[1:] + "."
}

// fakeText renders one value of a text-like category. now anchors birthdate.
func fakeText(cat string, rng *rand.Rand, now time.Time) string {
	switch cat {
	case "first_name":
		return pick(rng, "first_names")
	case "last_name":
		return pick(rng, "last_names")
	case "full_name":
		return pick(rng, "first_names") + " " + pick(rng, "last_names")
	case "email":
		return fmt.Sprintf("%s.%s%d@%s", lower(pick(rng, "first_names")), lower(pick(rng, "last_names")),
			rng.IntN(1000), emailDomains[rng.IntN(len(emailDomains))])
	case "username":
		return fmt.Sprintf("%s%s%d", lower(pick(rng, "first_names"))[:1], lower(pick(rng, "last_names")), rng.IntN(100))
	case "phone":
		return fmt.Sprintf("+1-%03d-%03d-%04d", 200+rng.IntN(800), 200+rng.IntN(800), rng.IntN(10000))
	case "company":
		return pick(rng, "companies")
	case "job_title":
		return pick(rng, "job_titles")
	case "street":
		return fmt.Sprintf("%d %s", 1+rng.IntN(9999), pick(rng, "streets"))
	case "city":
		return pick(rng, "cities")
	case "state":
		return pick(rng, "states")
	case "country":
		return pick(rng, "countries")
	case "zip":
		return fmt.Sprintf("%05d", rng.IntN(100000))
	case "url":
		return fmt.Sprintf("https://www.%s.%s/%s", lower(pick(rng, "words")), []string{"com", "org", "net"}[rng.IntN(3)], lower(pick(rng, "words")))
	case "ipv4":
		return ipv4(rng)
	case "ipv6":
		return ipv6(rng)
	case "word":
		return pick(rng, "words")
	case "sentence":
		return sentence(rng)
	case "paragraph":
		n := 3 + rng.IntN(3)
		s := make([]string, n)
		for i := range s {
			s[i] = sentence(rng)
		}
		return strings.Join(s, " ")
	case "color":
		return pick(rng, "colors")
	case "product":
		return pick(rng, "products")
	case "birthdate":
		days := 18*365 + rng.IntN(62*365)
		return now.AddDate(0, 0, -days).Format("2006-01-02")
	}
	return ""
}
