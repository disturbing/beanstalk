// Package invoice renders a plain-text invoice for an order.
package invoice

import (
	"fmt"
	"strings"

	"shop/internal/config"
	"shop/internal/money"
	"shop/internal/orders"
	"shop/internal/util/strutil"
)

// Width is the rendered line width.
const Width = 32

// Render returns the invoice text.
func Render(o *orders.Order) string {
	rows := []string{"INVOICE " + o.ID}
	for _, sku := range o.Cart.SKUs() {
		l := o.Cart.Lines[sku]
		rows = append(rows, strutil.PadRight(fmt.Sprintf("%d x %s", l.Qty, l.Product.Name), 20)+
			strutil.PadLeft(l.Total().Format(), 12))
	}
	q := o.Quote
	for _, r := range []struct {
		label  string
		amount money.Money
	}{
		{"Subtotal", q.Subtotal}, {"Discount", q.Discount}, {"Shipping", q.Shipping},
		{"Fees", q.Fees}, {"Tax", q.Tax}, {"Total", q.Total()},
	} {
		rows = append(rows, strutil.PadRight(r.label, 20)+strutil.PadLeft(r.amount.Format(), 12))
	}
	rows = append(rows, config.String("invoice_footer", ""))
	return strings.Join(rows, "\n")
}
