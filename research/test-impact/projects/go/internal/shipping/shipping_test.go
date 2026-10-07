package shipping

import (
	"testing"

	"shop/internal/cart"
	"shop/internal/testkit"
)

func shipCost(t *testing.T, c *cart.Cart, zone string) int64 {
	t.Helper()
	m, err := Cost(c, zone)
	if err != nil {
		t.Fatal(err)
	}
	return m.Cents
}

func TestShippingEmptyCartShipsFree(t *testing.T) {
	if got := shipCost(t, cart.New(), ""); got != 0 {
		t.Fatalf("got %d", got)
	}
}

func TestShippingDomesticByWeight(t *testing.T) {
	if got := shipCost(t, testkit.CartOf(t, map[string]int{"SKU-002": 1}), ""); got != 500+150*2 {
		t.Fatalf("got %d", got)
	}
}

func TestShippingFreeOverThreshold(t *testing.T) {
	if got := shipCost(t, testkit.CartOf(t, map[string]int{"SKU-006": 3}), ""); got != 0 {
		t.Fatalf("got %d", got)
	}
}

func TestShippingIntl(t *testing.T) {
	if got := shipCost(t, testkit.CartOf(t, map[string]int{"SKU-001": 1}), "intl"); got != 1500+600 {
		t.Fatalf("got %d", got)
	}
}
