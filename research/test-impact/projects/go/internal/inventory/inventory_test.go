package inventory_test

import (
	"errors"
	"testing"

	"shop/internal/inventory"
	"shop/internal/testkit"
)

func TestInventoryReserveAndRelease(t *testing.T) {
	s := testkit.Stocked()
	if err := s.Reserve("SKU-004", 2); err != nil {
		t.Fatal(err)
	}
	if s.Available("SKU-004") != 0 {
		t.Fatal("expected 0 available")
	}
	s.Release("SKU-004", 1)
	if s.Available("SKU-004") != 1 {
		t.Fatal("expected 1 available")
	}
}

func TestInventoryOutOfStock(t *testing.T) {
	err := testkit.Stocked().Reserve("SKU-006", 4)
	var oos inventory.OutOfStockError
	if !errors.As(err, &oos) {
		t.Fatalf("expected OutOfStockError, got %v", err)
	}
}

func TestInventoryCommit(t *testing.T) {
	s := testkit.Stocked()
	if err := s.Reserve("SKU-001", 3); err != nil {
		t.Fatal(err)
	}
	s.Commit("SKU-001", 3)
	if s.Levels["SKU-001"] != 7 || s.Available("SKU-001") != 7 {
		t.Fatalf("levels %d available %d", s.Levels["SKU-001"], s.Available("SKU-001"))
	}
}

func TestInventoryBadQty(t *testing.T) {
	if err := testkit.Stocked().Reserve("SKU-001", 0); !errors.Is(err, inventory.ErrBadQty) {
		t.Fatalf("expected ErrBadQty, got %v", err)
	}
}
