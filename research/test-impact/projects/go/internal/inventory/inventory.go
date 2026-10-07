// Package inventory tracks stock levels and reservations.
package inventory

import (
	"errors"
	"fmt"
)

// ErrBadQty is returned for non-positive quantities.
var ErrBadQty = errors.New("qty must be positive")

// OutOfStockError is returned when a reservation exceeds availability.
type OutOfStockError struct{ SKU string }

func (e OutOfStockError) Error() string { return fmt.Sprintf("out of stock: %s", e.SKU) }

// Inventory holds levels and reserved counts per SKU.
type Inventory struct {
	Levels   map[string]int
	Reserved map[string]int
}

// New copies levels into a fresh inventory.
func New(levels map[string]int) *Inventory {
	inv := &Inventory{Levels: map[string]int{}, Reserved: map[string]int{}}
	for k, v := range levels {
		inv.Levels[k] = v
	}
	return inv
}

// Available is level minus reserved.
func (i *Inventory) Available(sku string) int { return i.Levels[sku] - i.Reserved[sku] }

// Reserve holds qty units of sku.
func (i *Inventory) Reserve(sku string, qty int) error {
	if qty <= 0 {
		return ErrBadQty
	}
	if i.Available(sku) < qty {
		return OutOfStockError{sku}
	}
	i.Reserved[sku] += qty
	return nil
}

// Release returns reserved units, never going below zero.
func (i *Inventory) Release(sku string, qty int) {
	i.Reserved[sku] = max(0, i.Reserved[sku]-qty)
}

// Commit releases the reservation and removes the stock.
func (i *Inventory) Commit(sku string, qty int) {
	i.Release(sku, qty)
	i.Levels[sku] -= qty
}
