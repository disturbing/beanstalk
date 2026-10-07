// Package catalog loads products from data/catalog.csv.
package catalog

import (
	"encoding/csv"
	"fmt"
	"os"
	"sort"
	"strconv"
	"sync"

	"shop/internal/money"
	"shop/internal/paths"
	"shop/internal/util/validation"
)

// Product is one catalog entry.
type Product struct {
	SKU      string
	Name     string
	Price    money.Money
	WeightG  int
	Category string
}

// NotFoundError is returned by Find for an unknown SKU.
type NotFoundError struct{ SKU string }

func (e NotFoundError) Error() string { return "no product " + e.SKU }

var (
	once  sync.Once
	items map[string]Product
	err   error
)

// Catalog returns all products keyed by SKU.
func Catalog() (map[string]Product, error) {
	once.Do(func() { items, err = load() })
	return items, err
}

func load() (map[string]Product, error) {
	p, err := paths.Data("catalog.csv")
	if err != nil {
		return nil, err
	}
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	rows, err := csv.NewReader(f).ReadAll()
	if err != nil {
		return nil, err
	}
	out := map[string]Product{}
	for _, r := range rows[1:] {
		if err := validation.Require(validation.IsSKU(r[0]), "bad sku "+r[0]); err != nil {
			return nil, err
		}
		price, err := strconv.ParseInt(r[2], 10, 64)
		if err != nil {
			return nil, fmt.Errorf("price for %s: %w", r[0], err)
		}
		weight, err := strconv.Atoi(r[3])
		if err != nil {
			return nil, fmt.Errorf("weight for %s: %w", r[0], err)
		}
		out[r[0]] = Product{r[0], r[1], money.New(price), weight, r[4]}
	}
	return out, nil
}

// Find returns the product for sku.
func Find(sku string) (Product, error) {
	all, err := Catalog()
	if err != nil {
		return Product{}, err
	}
	p, ok := all[sku]
	if !ok {
		return Product{}, NotFoundError{sku}
	}
	return p, nil
}

// ByCategory returns the products in category sorted by SKU.
func ByCategory(category string) ([]Product, error) {
	all, err := Catalog()
	if err != nil {
		return nil, err
	}
	var out []Product
	for _, p := range all {
		if p.Category == category {
			out = append(out, p)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].SKU < out[j].SKU })
	return out, nil
}
