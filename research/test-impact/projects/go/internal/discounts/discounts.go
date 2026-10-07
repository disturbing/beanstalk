// Package discounts computes discount amounts for a cart.
package discounts

import (
	"shop/internal/cart"
	"shop/internal/config"
	"shop/internal/money"
)

// PercentOff takes pct off the subtotal, capped by max_discount_pct.
func PercentOff(c *cart.Cart, pct int64) money.Money {
	limit := int64(config.Number("max_discount_pct", 100))
	return c.Subtotal().Pct(float64(min(pct, limit)) / 100)
}

// ThresholdOff gives offCents once the subtotal reaches overCents.
func ThresholdOff(c *cart.Cart, overCents, offCents int64) money.Money {
	if c.Subtotal().Cents >= overCents {
		return money.New(offCents)
	}
	return money.Zero("USD")
}

// Bogo makes every second unit of sku free.
func Bogo(c *cart.Cart, sku string) money.Money {
	l, ok := c.Lines[sku]
	if !ok {
		return money.Zero("USD")
	}
	return l.Product.Price.Times(l.Qty / 2)
}
