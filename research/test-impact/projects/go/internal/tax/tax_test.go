package tax

import (
	"testing"

	"shop/internal/money"
)

func TestTaxDefaultRegionFromConfig(t *testing.T) {
	if r, err := Rate(""); err != nil || r != 0.0725 {
		t.Fatalf("got %v, %v", r, err)
	}
}

func TestTaxRegions(t *testing.T) {
	if r, err := Rate("OR"); err != nil || r != 0.0 {
		t.Fatalf("OR %v, %v", r, err)
	}
	if m, err := On(money.New(10000), "TX"); err != nil || m != money.New(625) {
		t.Fatalf("TX %v, %v", m, err)
	}
}
