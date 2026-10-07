// Package servicefee charges a percentage service fee.
package servicefee

import (
	"shop/internal/money"
	"shop/internal/plugins"
)

// Rate is the service fee rate.
const Rate = 0.02

// Fee returns Rate of base.
func Fee(base money.Money) money.Money { return base.Pct(Rate) }

func init() { plugins.Register("service_fee", Fee) }
