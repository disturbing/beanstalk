package pricing

import (
	"testing"

	"shop/internal/testkit"
)

func TestPricingPlainQuote(t *testing.T) {
	q, err := QuoteCart(testkit.CartOf(t, map[string]int{"SKU-001": 2}), "")
	if err != nil {
		t.Fatal(err)
	}
	if q.Subtotal.Cents != 2400 || q.Shipping.Cents != 650 || q.Fees.Cents != 48 || q.Tax.Cents != 174 {
		t.Fatalf("quote %+v", q)
	}
	if q.Total().Cents != 2400+650+48+174 {
		t.Fatalf("total %d", q.Total().Cents)
	}
}

func TestPricingPercentCoupon(t *testing.T) {
	q, err := QuoteCart(testkit.CartOf(t, map[string]int{"SKU-002": 1}), "PCT10")
	if err != nil {
		t.Fatal(err)
	}
	if q.Discount.Cents != 350 || q.Tax.Cents != 228 {
		t.Fatalf("quote %+v", q)
	}
}

func TestPricingFreeshipCoupon(t *testing.T) {
	q, err := QuoteWith(testkit.CartOf(t, map[string]int{"SKU-004": 1}), Options{Coupon: "FREESHIP", Region: "OR"})
	if err != nil {
		t.Fatal(err)
	}
	if q.Shipping.Cents != 0 || q.Tax.Cents != 0 {
		t.Fatalf("quote %+v", q)
	}
}
