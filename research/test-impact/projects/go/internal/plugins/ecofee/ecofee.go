// Package ecofee charges a flat eco fee.
package ecofee

import (
	"shop/internal/money"
	"shop/internal/plugins"
)

// Fee is a flat 25 cents.
func Fee(base money.Money) money.Money { return money.New(25) }

func init() { plugins.Register("eco_fee", Fee) }
