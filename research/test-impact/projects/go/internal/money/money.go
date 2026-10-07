// Package money holds integer-cent amounts tagged with a currency.
package money

import "fmt"

// Money is an amount in minor units (cents) of a currency.
type Money struct {
	Cents    int64
	Currency string
}

// MismatchError is the panic value when combining amounts in different currencies.
type MismatchError struct{ A, B string }

func (e MismatchError) Error() string {
	return fmt.Sprintf("currency mismatch %s != %s", e.A, e.B)
}

// New returns cents in USD.
func New(cents int64) Money { return Money{Cents: cents, Currency: "USD"} }

// In returns cents in the given currency.
func In(cents int64, currency string) Money { return Money{Cents: cents, Currency: currency} }

// Zero returns a zero amount in currency.
func Zero(currency string) Money { return Money{Currency: currency} }

// Add panics with MismatchError if currencies differ.
func (m Money) Add(o Money) Money {
	same(m, o)
	return Money{m.Cents + o.Cents, m.Currency}
}

// Sub panics with MismatchError if currencies differ.
func (m Money) Sub(o Money) Money {
	same(m, o)
	return Money{m.Cents - o.Cents, m.Currency}
}

// Times multiplies by a quantity.
func (m Money) Times(qty int) Money { return Money{m.Cents * int64(qty), m.Currency} }

// Pct applies a rate, rounding half up.
func (m Money) Pct(rate float64) Money {
	return Money{RoundHalfUp(float64(m.Cents) * rate), m.Currency}
}

// Format renders e.g. "1234.56 USD".
func (m Money) Format() string {
	sign := ""
	c := m.Cents
	if c < 0 {
		sign = "-"
		c = -c
	}
	return fmt.Sprintf("%s%d.%02d %s", sign, c/100, c%100, m.Currency)
}

// RoundHalfUp rounds away from zero at .5.
func RoundHalfUp(x float64) int64 {
	if x >= 0 {
		return int64(x + 0.5)
	}
	return -int64(-x + 0.5)
}

func same(a, b Money) {
	if a.Currency != b.Currency {
		panic(MismatchError{a.Currency, b.Currency})
	}
}
