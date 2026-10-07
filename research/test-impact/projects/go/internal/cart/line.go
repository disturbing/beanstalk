package cart

import (
	"shop/internal/catalog"
	"shop/internal/money"
)

// Line is a product and a quantity.
type Line struct {
	Product catalog.Product
	Qty     int
}

// Total is price times quantity.
func (l *Line) Total() money.Money { return l.Product.Price.Times(l.Qty) }
