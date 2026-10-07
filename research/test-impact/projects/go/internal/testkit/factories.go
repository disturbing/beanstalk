// Package testkit holds shared test helpers: factories and fixture loading.
package testkit

import (
	"testing"

	"shop/internal/cart"
	"shop/internal/inventory"
)

// CartOf builds a cart from SKU quantities, failing the test on error.
func CartOf(t testing.TB, qty map[string]int) *cart.Cart {
	t.Helper()
	c := cart.New()
	for sku, n := range qty {
		if err := c.Add(sku, n); err != nil {
			t.Fatalf("CartOf: add %s: %v", sku, err)
		}
	}
	return c
}

// Stocked returns the standard stocked inventory.
func Stocked() *inventory.Inventory {
	return inventory.New(map[string]int{
		"SKU-001": 10, "SKU-002": 5, "SKU-003": 100, "SKU-004": 2, "SKU-005": 20, "SKU-006": 3,
	})
}
