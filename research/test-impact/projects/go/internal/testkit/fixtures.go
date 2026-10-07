package testkit

import (
	"encoding/json"
	"os"
	"testing"

	"shop/internal/paths"
)

// FixtureOrder is one entry of testdata/orders.json.
type FixtureOrder struct {
	Lines  map[string]int `json:"lines"`
	Coupon string         `json:"coupon"`
}

// FixtureOrders loads internal/testkit/testdata/orders.json at runtime.
func FixtureOrders(t testing.TB) []FixtureOrder {
	t.Helper()
	p, err := paths.File("internal", "testkit", "testdata", "orders.json")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	var out []FixtureOrder
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}
