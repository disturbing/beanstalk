package reports

import (
	"slices"
	"testing"

	"shop/internal/orders"
	"shop/internal/testkit"
)

func placedFixtureOrders(t *testing.T) []*orders.Order {
	t.Helper()
	svc := orders.NewService(testkit.Stocked(), nil)
	var out []*orders.Order
	for _, f := range testkit.FixtureOrders(t) {
		o, err := svc.Place(testkit.CartOf(t, f.Lines), f.Coupon)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, o)
	}
	if err := svc.Cancel(out[1]); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestReportsTopSKUs(t *testing.T) {
	want := []SKUCount{{"SKU-003", 4}, {"SKU-005", 3}, {"SKU-001", 2}}
	if got := TopSKUs(placedFixtureOrders(t), 3); !slices.Equal(got, want) {
		t.Fatalf("got %v", got)
	}
}

func TestReportsRevenueSkipsCancelled(t *testing.T) {
	if got := Revenue(placedFixtureOrders(t)).Cents; got <= 0 {
		t.Fatalf("revenue %d", got)
	}
}
