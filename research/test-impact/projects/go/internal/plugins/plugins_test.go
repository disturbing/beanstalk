package plugins_test

import (
	"testing"

	"shop/internal/money"
	"shop/internal/plugins"
	_ "shop/internal/plugins/all"
)

func TestPluginsConfiguredFees(t *testing.T) {
	got, err := plugins.TotalFees(money.New(10000))
	if err != nil || got.Cents != 200 {
		t.Fatalf("got %v, %v", got, err)
	}
}

func TestPluginsLoadByName(t *testing.T) {
	fee, err := plugins.Load("service_fee")
	if err != nil {
		t.Fatal(err)
	}
	if got := fee(money.New(500)).Cents; got != 10 {
		t.Fatalf("fee %d", got)
	}
}
