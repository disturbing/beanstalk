// Package shipping prices delivery using data/shipping_zones.json.
package shipping

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"

	"shop/internal/cart"
	"shop/internal/config"
	"shop/internal/money"
	"shop/internal/paths"
)

// Zone is a base charge plus a per-kg charge.
type Zone struct {
	BaseCents  int64 `json:"base_cents"`
	PerKgCents int64 `json:"per_kg_cents"`
}

var (
	once  sync.Once
	zones map[string]Zone
	err   error
)

// Zones returns the zone table.
func Zones() (map[string]Zone, error) {
	once.Do(func() {
		var p string
		if p, err = paths.Data("shipping_zones.json"); err != nil {
			return
		}
		var raw []byte
		if raw, err = os.ReadFile(p); err != nil {
			return
		}
		err = json.Unmarshal(raw, &zones)
	})
	return zones, err
}

// Cost prices shipping for cart in zone ("" means domestic).
func Cost(c *cart.Cart, zone string) (money.Money, error) {
	if zone == "" {
		zone = "domestic"
	}
	if c.Count() == 0 {
		return money.Zero("USD"), nil
	}
	freeOver := int64(config.Number("free_shipping_over", 1e9))
	if zone == "domestic" && c.Subtotal().Cents >= freeOver*100 {
		return money.Zero("USD"), nil
	}
	all, err := Zones()
	if err != nil {
		return money.Money{}, err
	}
	z, ok := all[zone]
	if !ok {
		return money.Money{}, fmt.Errorf("unknown zone %q", zone)
	}
	kg := int64((c.WeightG() + 999) / 1000)
	return money.New(z.BaseCents + z.PerKgCents*kg), nil
}
