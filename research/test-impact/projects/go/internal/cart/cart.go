// Package cart holds lines of catalog products.
package cart

import (
	"errors"
	"sort"

	"shop/internal/catalog"
	"shop/internal/money"
)

// ErrBadQty is returned for non-positive quantities.
var ErrBadQty = errors.New("qty must be positive")

// Cart maps SKU to line.
type Cart struct {
	Lines map[string]*Line
}

// New returns an empty cart.
func New() *Cart { return &Cart{Lines: map[string]*Line{}} }

// Add adds qty of sku, merging with an existing line.
func (c *Cart) Add(sku string, qty int) error {
	if qty <= 0 {
		return ErrBadQty
	}
	if l, ok := c.Lines[sku]; ok {
		l.Qty += qty
		return nil
	}
	p, err := catalog.Find(sku)
	if err != nil {
		return err
	}
	c.Lines[sku] = &Line{Product: p, Qty: qty}
	return nil
}

// Remove drops a line if present.
func (c *Cart) Remove(sku string) { delete(c.Lines, sku) }

// SKUs returns line keys sorted.
func (c *Cart) SKUs() []string {
	out := make([]string, 0, len(c.Lines))
	for k := range c.Lines {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// Subtotal sums line totals.
func (c *Cart) Subtotal() money.Money {
	total := money.Zero("USD")
	for _, sku := range c.SKUs() {
		total = total.Add(c.Lines[sku].Total())
	}
	return total
}

// WeightG sums line weights in grams.
func (c *Cart) WeightG() int {
	n := 0
	for _, l := range c.Lines {
		n += l.Product.WeightG * l.Qty
	}
	return n
}

// Count sums quantities.
func (c *Cart) Count() int {
	n := 0
	for _, l := range c.Lines {
		n += l.Qty
	}
	return n
}
