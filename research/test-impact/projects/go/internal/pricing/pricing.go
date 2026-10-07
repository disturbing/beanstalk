// Package pricing combines discounts, shipping, fee plugins and tax into a Quote.
package pricing

import (
	"shop/internal/cart"
	"shop/internal/coupons"
	"shop/internal/discounts"
	"shop/internal/money"
	"shop/internal/plugins"
	_ "shop/internal/plugins/all"
	"shop/internal/shipping"
	"shop/internal/tax"
)

// Options are the optional quote inputs; zero values mean defaults.
type Options struct {
	Coupon string
	Zone   string
	Region string
}

// QuoteCart quotes with only an optional coupon.
func QuoteCart(c *cart.Cart, coupon string) (Quote, error) {
	return QuoteWith(c, Options{Coupon: coupon})
}

// QuoteWith quotes with all options.
func QuoteWith(c *cart.Cart, o Options) (Quote, error) {
	subtotal := c.Subtotal()
	discount := money.Zero("USD")
	ship, err := shipping.Cost(c, o.Zone)
	if err != nil {
		return Quote{}, err
	}
	if o.Coupon != "" {
		cp, err := coupons.Parse(o.Coupon)
		if err != nil {
			return Quote{}, err
		}
		switch cp.Kind {
		case "percent":
			discount = discounts.PercentOff(c, cp.Value)
		case "amount":
			discount = money.New(min(cp.Value, subtotal.Cents))
		case "shipping":
			ship = money.Zero("USD")
		}
	}
	fees, err := plugins.TotalFees(subtotal.Sub(discount))
	if err != nil {
		return Quote{}, err
	}
	taxed, err := tax.On(subtotal.Sub(discount), o.Region)
	if err != nil {
		return Quote{}, err
	}
	return Quote{subtotal, discount, ship, fees, taxed}, nil
}
