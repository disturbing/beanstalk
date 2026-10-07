package discounts

import (
	"testing"

	"shop/internal/coupons"
	"shop/internal/testkit"
)

func TestDiscountsPercentOffCapped(t *testing.T) {
	c := testkit.CartOf(t, map[string]int{"SKU-002": 2})
	if got := PercentOff(c, 10).Cents; got != 700 {
		t.Fatalf("10%% = %d", got)
	}
	if got := PercentOff(c, 80).Cents; got != 3500 {
		t.Fatalf("80%% = %d", got)
	}
}

func TestDiscountsThreshold(t *testing.T) {
	c := testkit.CartOf(t, map[string]int{"SKU-004": 1})
	if ThresholdOff(c, 4000, 500).Cents != 500 || ThresholdOff(c, 5000, 500).Cents != 0 {
		t.Fatal("threshold")
	}
}

func TestDiscountsBogo(t *testing.T) {
	c := testkit.CartOf(t, map[string]int{"SKU-005": 5})
	if got := Bogo(c, "SKU-005").Cents; got != 3600 {
		t.Fatalf("bogo %d", got)
	}
}

func TestDiscountsCouponParse(t *testing.T) {
	cases := map[string]coupons.Coupon{
		" pct15 ":  {Kind: "percent", Value: 15},
		"OFF7":     {Kind: "amount", Value: 700},
		"freeship": {Kind: "shipping", Value: 0},
	}
	for code, want := range cases {
		got, err := coupons.Parse(code)
		if err != nil || got != want {
			t.Errorf("Parse(%q) = %v, %v", code, got, err)
		}
	}
}
