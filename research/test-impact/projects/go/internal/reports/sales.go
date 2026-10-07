// Package reports summarises orders.
package reports

import (
	"sort"

	"shop/internal/money"
	"shop/internal/orders"
)

// SKUCount is a SKU and units sold.
type SKUCount struct {
	SKU string
	Qty int
}

// Revenue sums totals of orders that are not cancelled.
func Revenue(list []*orders.Order) money.Money {
	total := money.Zero("USD")
	for _, o := range list {
		if o.State != "cancelled" {
			total = total.Add(o.Quote.Total())
		}
	}
	return total
}

// TopSKUs returns the n best-selling SKUs by units, ties by SKU.
func TopSKUs(list []*orders.Order, n int) []SKUCount {
	counts := map[string]int{}
	for _, o := range list {
		for sku, l := range o.Cart.Lines {
			counts[sku] += l.Qty
		}
	}
	out := make([]SKUCount, 0, len(counts))
	for k, v := range counts {
		out = append(out, SKUCount{k, v})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Qty != out[j].Qty {
			return out[i].Qty > out[j].Qty
		}
		return out[i].SKU < out[j].SKU
	})
	if len(out) > n {
		out = out[:n]
	}
	return out
}
