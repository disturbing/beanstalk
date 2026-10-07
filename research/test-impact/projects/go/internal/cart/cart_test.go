package cart_test

import (
	"testing"

	"shop/internal/testkit"
)

func TestCartSubtotal(t *testing.T) {
	c := testkit.CartOf(t, map[string]int{"SKU-001": 2, "SKU-003": 1})
	if c.Subtotal().Cents != 2850 {
		t.Fatalf("subtotal %d", c.Subtotal().Cents)
	}
}

func TestCartAddMergesLines(t *testing.T) {
	c := testkit.CartOf(t, map[string]int{"SKU-001": 1})
	if err := c.Add("SKU-001", 2); err != nil {
		t.Fatal(err)
	}
	if c.Count() != 3 || len(c.Lines) != 1 {
		t.Fatalf("count %d lines %d", c.Count(), len(c.Lines))
	}
}

func TestCartRemoveAndWeight(t *testing.T) {
	c := testkit.CartOf(t, map[string]int{"SKU-002": 1, "SKU-005": 2})
	if c.WeightG() != 1560 {
		t.Fatalf("weight %d", c.WeightG())
	}
	c.Remove("SKU-002")
	if c.WeightG() != 360 {
		t.Fatalf("weight %d", c.WeightG())
	}
}
