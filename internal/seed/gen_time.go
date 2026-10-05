package seed

import (
	"fmt"
	"math/rand/v2"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/0funct0ry/helenus/internal/codec"
)

func uuidV4(rng *rand.Rand) string {
	var b [16]byte
	hi, lo := rng.Uint64(), rng.Uint64()
	for i := 0; i < 8; i++ {
		b[i], b[8+i] = byte(hi>>(8*i)), byte(lo>>(8*i))
	}
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

// timeUUID builds a version 1 UUID for t with a random clock sequence and node.
func timeUUID(t time.Time, rng *rand.Rand) string {
	ticks := uint64(t.UnixNano()/100) + 0x01B21DD213814000
	low, mid, hi := uint32(ticks), uint16(ticks>>32), uint16(ticks>>48)&0x0fff|0x1000
	clock := uint16(rng.Uint32())&0x3fff | 0x8000
	node := rng.Uint64() & 0xffffffffffff
	node |= 0x010000000000
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", low, mid, hi, clock, node)
}

func randTime(rng *rand.Rand, from, to time.Time) time.Time {
	span := to.Sub(from).Milliseconds()
	if span <= 0 {
		return from
	}
	return from.Add(time.Duration(rng.Int64N(span+1)) * time.Millisecond)
}

var relTime = regexp.MustCompile(`^now(?:([+-])(\d+)([smhdwy]))?$`)

// parseTimeExpr reads "now", "now-30d", "now+2h", an RFC 3339 timestamp or a
// YYYY-MM-DD date. now is the (day-truncated) anchor.
func parseTimeExpr(s string, now time.Time) (time.Time, error) {
	s = strings.TrimSpace(s)
	if m := relTime.FindStringSubmatch(s); m != nil {
		if m[1] == "" {
			return now, nil
		}
		n, _ := strconv.Atoi(m[2])
		if m[1] == "-" {
			n = -n
		}
		unit := map[string]time.Duration{"s": time.Second, "m": time.Minute, "h": time.Hour,
			"d": 24 * time.Hour, "w": 7 * 24 * time.Hour, "y": 365 * 24 * time.Hour}[m[3]]
		return now.Add(time.Duration(n) * unit), nil
	}
	for _, l := range []string{time.RFC3339Nano, "2006-01-02T15:04:05", "2006-01-02"} {
		if t, err := time.Parse(l, s); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("%q is not a time: use now, now-30d, 2024-01-31 or an RFC 3339 timestamp", s)
}

func (b *builder) timeBounds(p params, defFrom, defTo string) (time.Time, time.Time) {
	get := func(key, def string) time.Time {
		t, err := parseTimeExpr(p.str(key, def), b.now)
		if err != nil {
			b.sink.add(p.fieldOf(key), "%s", err)
			return b.now
		}
		return t
	}
	from, to := get("from", defFrom), get("to", defTo)
	if from.After(to) {
		b.sink.add(p.fieldOf("from"), "from must not be after to")
	}
	return from, to
}

func (b *builder) timeRange(p params, td codec.TypeDesc) Generator {
	if td.Name == "time" {
		parse := func(key, def string) int64 {
			s := p.str(key, def)
			d, err := time.Parse("15:04:05", s)
			if err != nil {
				b.sink.add(p.fieldOf(key), "%q is not HH:MM:SS", s)
				return 0
			}
			return int64(d.Hour()*3600 + d.Minute()*60 + d.Second())
		}
		from, to := parse("from", "00:00:00"), parse("to", "23:59:59")
		if from > to {
			b.sink.add(p.fieldOf("from"), "from must not be after to")
			return nil
		}
		return fn(func(rng *rand.Rand) any {
			s := from + rng.Int64N(to-from+1)
			return fmt.Sprintf("%02d:%02d:%02d", s/3600, s/60%60, s%60)
		})
	}
	from, to := b.timeBounds(p, "now-30d", "now")
	if td.Name == "date" {
		days := int64(to.Sub(from).Hours() / 24)
		return fn(func(rng *rand.Rand) any {
			return from.AddDate(0, 0, int(rng.Int64N(days+1))).Format("2006-01-02")
		})
	}
	return fn(func(rng *rand.Rand) any {
		return randTime(rng, from, to).UTC().Format("2006-01-02T15:04:05.000Z")
	})
}

func durationText(secs int64) string {
	if secs == 0 {
		return "0s"
	}
	var sb strings.Builder
	for _, u := range []struct {
		n int64
		s string
	}{{86400, "d"}, {3600, "h"}, {60, "m"}, {1, "s"}} {
		if q := secs / u.n; q > 0 {
			fmt.Fprintf(&sb, "%d%s", q, u.s)
			secs %= u.n
		}
	}
	return sb.String()
}

func inetGen(b *builder, p params) Generator {
	switch v := p.str("version", "v4"); v {
	case "v4":
		return fn(func(rng *rand.Rand) any { return ipv4(rng) })
	case "v6":
		return fn(func(rng *rand.Rand) any { return ipv6(rng) })
	default:
		b.sink.add(p.fieldOf("version"), "version must be v4 or v6")
		return nil
	}
}
