package pricing

import "shop/internal/money"

// Quote is the price breakdown for a cart.
type Quote struct {
	Subtotal money.Money
	Discount money.Money
	Shipping money.Money
	Fees     money.Money
	Tax      money.Money
}

// Total is subtotal - discount + shipping + fees + tax.
func (q Quote) Total() money.Money {
	return q.Subtotal.Sub(q.Discount).Add(q.Shipping).Add(q.Fees).Add(q.Tax)
}
