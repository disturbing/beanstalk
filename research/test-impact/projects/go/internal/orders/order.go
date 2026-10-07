package orders

import (
	"fmt"

	"shop/internal/cart"
	"shop/internal/pricing"
)

var transitions = map[string]map[string]bool{
	"new":     {"paid": true, "cancelled": true},
	"paid":    {"shipped": true, "refunded": true},
	"shipped": {"delivered": true},
}

// Order is a placed cart with its quote and lifecycle state.
type Order struct {
	ID      string
	Cart    *cart.Cart
	Quote   pricing.Quote
	State   string
	History []string
}

// Move transitions to state to if allowed.
func (o *Order) Move(to string) error {
	if !transitions[o.State][to] {
		return fmt.Errorf("cannot go %s -> %s", o.State, to)
	}
	o.History = append(o.History, o.State)
	o.State = to
	return nil
}
