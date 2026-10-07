// Package tax applies regional rates compiled in from tax.json.
package tax

import (
	_ "embed"
	"encoding/json"
	"fmt"

	"shop/internal/config"
	"shop/internal/money"
)

//go:embed tax.json
var raw []byte

var table = mustParse(raw)

func mustParse(b []byte) map[string]float64 {
	var t map[string]float64
	if err := json.Unmarshal(b, &t); err != nil {
		panic(err)
	}
	return t
}

// Table returns the rate table.
func Table() map[string]float64 { return table }

// Rate returns the rate for region; "" means the configured tax_region.
func Rate(region string) (float64, error) {
	if region == "" {
		region = config.String("tax_region", "")
	}
	r, ok := table[region]
	if !ok {
		return 0, fmt.Errorf("no tax rate for region %q", region)
	}
	return r, nil
}

// On returns the tax due on amount.
func On(amount money.Money, region string) (money.Money, error) {
	r, err := Rate(region)
	if err != nil {
		return money.Money{}, err
	}
	return amount.Pct(r), nil
}
