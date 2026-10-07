package invoice

import (
	"strings"
	"testing"

	"shop/internal/inventory"
	"shop/internal/orders"
	"shop/internal/testkit"
)

func TestInvoiceLines(t *testing.T) {
	svc := orders.NewService(inventory.New(map[string]int{"SKU-003": 10}), nil)
	o, err := svc.Place(testkit.CartOf(t, map[string]int{"SKU-003": 2}), "")
	if err != nil {
		t.Fatal(err)
	}
	text := strings.Split(Render(o), "\n")
	checks := map[int]string{
		0:             "INVOICE ORD00001",
		1:             "2 x Notebook            9.00 USD",
		len(text) - 2: "Total                  16.33 USD",
		len(text) - 1: "Thank you for shopping",
	}
	for i, want := range checks {
		if text[i] != want {
			t.Errorf("line %d = %q, want %q", i, text[i], want)
		}
	}
}
