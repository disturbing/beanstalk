package payments

import (
	"testing"

	"shop/internal/money"
)

func TestPaymentsLuhn(t *testing.T) {
	if !LuhnOK("4539 1488 0343 6467") || LuhnOK("4539 1488 0343 6468") || LuhnOK("1234") {
		t.Fatal("luhn")
	}
}

func TestPaymentsCharge(t *testing.T) {
	cases := []struct {
		card  string
		cents int64
		want  string
	}{
		{"4539148803436467", 100, "approved"},
		{"4539148803436468", 100, "rejected:card"},
		{"4539148803436467", 0, "rejected:amount"},
	}
	for _, c := range cases {
		if got := Charge(c.card, money.New(c.cents)); got != c.want {
			t.Errorf("Charge(%s, %d) = %s, want %s", c.card, c.cents, got, c.want)
		}
	}
}
