package orders

import (
	"slices"
	"testing"

	"shop/internal/events"
	"shop/internal/testkit"
)

func TestOrdersPlaceReservesAndEmits(t *testing.T) {
	stocked := testkit.Stocked()
	bus := events.NewBus()
	var seen []string
	bus.On("order.placed", func(p string) { seen = append(seen, p) })
	o, err := NewService(stocked, bus).Place(testkit.CartOf(t, map[string]int{"SKU-004": 2}), "")
	if err != nil {
		t.Fatal(err)
	}
	if o.ID != "ORD00001" || stocked.Available("SKU-004") != 0 || !slices.Equal(seen, []string{"ORD00001"}) {
		t.Fatalf("id %s available %d seen %v", o.ID, stocked.Available("SKU-004"), seen)
	}
}

func TestOrdersCancelReleases(t *testing.T) {
	stocked := testkit.Stocked()
	svc := NewService(stocked, nil)
	o, err := svc.Place(testkit.CartOf(t, map[string]int{"SKU-006": 3}), "")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.Cancel(o); err != nil {
		t.Fatal(err)
	}
	if o.State != "cancelled" || stocked.Available("SKU-006") != 3 {
		t.Fatalf("state %s available %d", o.State, stocked.Available("SKU-006"))
	}
}

func TestOrdersBadTransition(t *testing.T) {
	o, err := NewService(testkit.Stocked(), nil).Place(testkit.CartOf(t, map[string]int{"SKU-001": 1}), "")
	if err != nil {
		t.Fatal(err)
	}
	if err := o.Move("shipped"); err == nil {
		t.Fatal("expected error")
	}
}

func TestOrdersFixtureOrders(t *testing.T) {
	svc := NewService(testkit.Stocked(), nil)
	var got []string
	for _, f := range testkit.FixtureOrders(t) {
		o, err := svc.Place(testkit.CartOf(t, f.Lines), f.Coupon)
		if err != nil {
			t.Fatal(err)
		}
		got = append(got, o.ID)
	}
	if !slices.Equal(got, []string{"ORD00001", "ORD00002", "ORD00003", "ORD00004"}) {
		t.Fatalf("got %v", got)
	}
}
