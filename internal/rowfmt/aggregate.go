package rowfmt

import (
	"encoding/json"
	"fmt"
	"math/big"
	"sort"
	"strings"

	"github.com/0funct0ry/helenus/internal/codec"
	"github.com/0funct0ry/helenus/internal/exec"
)

// Dash is shown for figures that cannot be computed.
const Dash = "—"

// AggregateRequest is the body of POST /rows/aggregate.
type AggregateRequest struct {
	Columns []exec.Column       `json:"columns"`
	Rows    [][]json.RawMessage `json:"rows"`
	// UDT resolves user-defined type fields; set by the server.
	UDT codec.UDTFieldTypes `json:"-"`
}

// Line is one KEY: value figure.
type Line struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// AggregateResult holds the figures in display order and as copyable text.
type AggregateResult struct {
	Lines []Line `json:"lines"`
	Text  string `json:"text"`
}

var numericTypes = map[string]bool{
	"tinyint": true, "smallint": true, "int": true, "bigint": true, "varint": true,
	"float": true, "double": true, "decimal": true, "counter": true,
}

// Aggregate computes ROWS, COLS, COUNT, COUNT_NUMS, SUM, AVG, MIN, MAX, MEDIAN
// and COEFFICIENT_OF_VARIATION with exact rational arithmetic.
func Aggregate(req AggregateRequest) (AggregateResult, error) {
	t, err := decode(req.Columns, req.Rows, req.UDT)
	if err != nil {
		return AggregateResult{}, err
	}
	count := 0
	var nums []*big.Rat
	for r := range t.vals {
		for c := range t.cols {
			s, null := t.text(r, c)
			if null {
				continue
			}
			count++
			if !numericTypes[strings.ToLower(t.cols[c].Type.Name)] {
				continue
			}
			if v, ok := new(big.Rat).SetString(s); ok { // NaN and ±Infinity do not parse
				nums = append(nums, v)
			}
		}
	}
	vals := map[string]string{
		"ROWS": fmt.Sprint(len(t.vals)), "COLS": fmt.Sprint(len(t.cols)),
		"COUNT": fmt.Sprint(count), "COUNT_NUMS": fmt.Sprint(len(nums)),
	}
	for _, k := range []string{"AVG", "COEFFICIENT_OF_VARIATION", "MAX", "MEDIAN", "MIN", "SUM"} {
		vals[k] = Dash
	}
	if n := len(nums); n > 0 {
		sum := new(big.Rat)
		for _, v := range nums {
			sum.Add(sum, v)
		}
		sort.Slice(nums, func(i, j int) bool { return nums[i].Cmp(nums[j]) < 0 })
		bn := new(big.Rat).SetInt64(int64(n))
		avg := new(big.Rat).Quo(sum, bn)
		median := nums[n/2]
		if n%2 == 0 {
			median = new(big.Rat).Quo(new(big.Rat).Add(nums[n/2-1], nums[n/2]), big.NewRat(2, 1))
		}
		vals["SUM"] = exact(sum)
		vals["MIN"] = exact(nums[0])
		vals["MAX"] = exact(nums[n-1])
		vals["MEDIAN"] = exact(median)
		vals["AVG"] = sig(avg, 34)
		if avg.Sign() != 0 {
			vals["COEFFICIENT_OF_VARIATION"] = cv(nums, avg)
		}
	}
	keys := make([]string, 0, len(vals))
	for k := range vals {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var res AggregateResult
	var b strings.Builder
	for i, k := range keys {
		res.Lines = append(res.Lines, Line{Key: k, Value: vals[k]})
		if i > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(k + ": " + vals[k])
	}
	res.Text = b.String()
	return res, nil
}

// cv is the population standard deviation over |avg|, as a percentage.
func cv(nums []*big.Rat, avg *big.Rat) string {
	variance := new(big.Rat)
	for _, v := range nums {
		d := new(big.Rat).Sub(v, avg)
		variance.Add(variance, d.Mul(d, d))
	}
	variance.Quo(variance, new(big.Rat).SetInt64(int64(len(nums))))
	const prec = 256
	f := new(big.Float).SetPrec(prec).SetRat(variance)
	sd := new(big.Float).SetPrec(prec).Sqrt(f)
	abs := new(big.Rat).Abs(avg)
	pct := sd.Quo(sd, new(big.Float).SetPrec(prec).SetRat(abs))
	pct.Mul(pct, big.NewFloat(100).SetPrec(prec))
	return pct.Text('f', 2) + "%"
}

// exact renders r in full decimal expansion with trailing zeros trimmed. The
// inputs here (sums, extremes, medians of decimals) always terminate; the loop
// cap only guards against a non-terminating value.
func exact(r *big.Rat) string {
	return fixed(r, 1000)
}

func fixed(r *big.Rat, maxFrac int) string {
	neg := r.Sign() < 0
	n := new(big.Int).Abs(r.Num())
	d := r.Denom()
	q, rem := new(big.Int).QuoRem(n, d, new(big.Int))
	var frac strings.Builder
	ten := big.NewInt(10)
	for i := 0; i < maxFrac && rem.Sign() != 0; i++ {
		rem.Mul(rem, ten)
		digit, m := new(big.Int).QuoRem(rem, d, new(big.Int))
		frac.WriteString(digit.String())
		rem = m
	}
	out := q.String()
	if f := strings.TrimRight(frac.String(), "0"); f != "" {
		out += "." + f
	}
	if neg && out != "0" {
		out = "-" + out
	}
	return out
}

// sig rounds r half-up to digits significant digits and trims trailing zeros.
func sig(r *big.Rat, digits int) string {
	if r.Sign() == 0 {
		return "0"
	}
	abs := new(big.Rat).Abs(r)
	one := big.NewRat(1, 1)
	mag := len(abs.Num().String()) - len(abs.Denom().String()) // estimate of floor(log10)
	pow := func(e int) *big.Rat {
		p := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(abs64(e))), nil)
		if e >= 0 {
			return new(big.Rat).SetInt(p)
		}
		return new(big.Rat).SetFrac(big.NewInt(1), p)
	}
	for abs.Cmp(new(big.Rat).Mul(pow(mag+1), one)) >= 0 {
		mag++
	}
	for abs.Cmp(pow(mag)) < 0 {
		mag--
	}
	scale := digits - 1 - mag // number of fractional digits to keep (may be negative)
	scaled := new(big.Rat).Mul(abs, pow(scale))
	two := big.NewInt(2)
	num := new(big.Int).Mul(scaled.Num(), two)
	num.Add(num, scaled.Denom())
	q := num.Quo(num, new(big.Int).Mul(scaled.Denom(), two)) // floor(x + 1/2)
	res := new(big.Rat).SetInt(q)
	res.Quo(res, pow(scale))
	out := fixed(res, 1000)
	if r.Sign() < 0 {
		out = "-" + out
	}
	return out
}

func abs64(e int) int {
	if e < 0 {
		return -e
	}
	return e
}
