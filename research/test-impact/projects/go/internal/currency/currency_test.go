package currency

import (
	"testing"

	"shop/internal/money"
)

func TestCurrencyRatesLoaded(t *testing.T) {
	r, err := Rates()
	if err != nil {
		t.Fatal(err)
	}
	if r["EUR"] != 0.9 || len(r) != 5 {
		t.Fatalf("rates = %v", r)
	}
}

func TestCurrencyConvertUSDToJPY(t *testing.T) {
	got, err := Convert(money.New(1000), "JPY")
	if err != nil || got != money.In(150000, "JPY") {
		t.Fatalf("got %v, %v", got, err)
	}
}

func TestCurrencyConvertRoundTrip(t *testing.T) {
	eur, err := Convert(money.New(1000), "EUR")
	if err != nil || eur != money.In(900, "EUR") {
		t.Fatalf("eur %v, %v", eur, err)
	}
	usd, err := Convert(eur, "USD")
	if err != nil || usd != money.New(1000) {
		t.Fatalf("usd %v, %v", usd, err)
	}
}

func TestCurrencyUnknown(t *testing.T) {
	if _, err := Convert(money.New(1), "XXX"); err == nil {
		t.Fatal("expected error")
	}
}
