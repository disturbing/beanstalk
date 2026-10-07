// Package orders places and cancels orders against inventory.
package orders

import (
	"shop/internal/cart"
	"shop/internal/events"
	"shop/internal/ids"
	"shop/internal/inventory"
	"shop/internal/pricing"
)

// Service places orders.
type Service struct {
	Inventory *inventory.Inventory
	Bus       *events.Bus
	seq       *ids.Sequence
}

// NewService builds a service; a nil bus gets a fresh one.
func NewService(inv *inventory.Inventory, bus *events.Bus) *Service {
	if bus == nil {
		bus = events.NewBus()
	}
	return &Service{Inventory: inv, Bus: bus, seq: ids.NewSequence("ORD", 1)}
}

// Place reserves stock, quotes and emits order.placed.
func (s *Service) Place(c *cart.Cart, coupon string) (*Order, error) {
	for _, sku := range c.SKUs() {
		if err := s.Inventory.Reserve(sku, c.Lines[sku].Qty); err != nil {
			return nil, err
		}
	}
	q, err := pricing.QuoteCart(c, coupon)
	if err != nil {
		return nil, err
	}
	o := &Order{ID: s.seq.Take(), Cart: c, Quote: q, State: "new"}
	s.Bus.Emit("order.placed", o.ID)
	return o, nil
}

// Cancel cancels the order and releases its stock.
func (s *Service) Cancel(o *Order) error {
	if err := o.Move("cancelled"); err != nil {
		return err
	}
	for sku, l := range o.Cart.Lines {
		s.Inventory.Release(sku, l.Qty)
	}
	s.Bus.Emit("order.cancelled", o.ID)
	return nil
}
