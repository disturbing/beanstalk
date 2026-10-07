package money

import (
	"errors"
	"testing"
)

func TestMoneyAddSub(t *testing.T) {
	if got := New(150).Add(New(250)); got != New(400) {
		t.Fatalf("add = %v", got)
	}
	if got := New(500).Sub(New(120)); got != New(380) {
		t.Fatalf("sub = %v", got)
	}
}

func TestMoneyCurrencyMismatch(t *testing.T) {
	defer func() {
		r := recover()
		var me MismatchError
		if err, ok := r.(error); !ok || !errors.As(err, &me) {
			t.Fatalf("expected MismatchError panic, got %v", r)
		}
	}()
	In(1, "USD").Add(In(1, "EUR"))
}

func TestMoneyPctRoundsHalfUp(t *testing.T) {
	if got := New(1000).Pct(0.0725); got != New(73) {
		t.Fatalf("pct = %v", got)
	}
	if RoundHalfUp(2.5) != 3 || RoundHalfUp(-2.5) != -3 {
		t.Fatal("round half up")
	}
}

func TestMoneyFormat(t *testing.T) {
	cases := map[string]Money{"1234.56 USD": New(123456), "-0.05 USD": New(-5), "0.00 EUR": Zero("EUR")}
	for want, m := range cases {
		if got := m.Format(); got != want {
			t.Errorf("Format = %q, want %q", got, want)
		}
	}
}
