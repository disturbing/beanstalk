// Package currency converts Money using the rates table in data/rates.csv.
package currency

import (
	"encoding/csv"
	"fmt"
	"os"
	"strconv"
	"sync"

	"shop/internal/money"
	"shop/internal/paths"
)

var (
	ratesOnce sync.Once
	ratesTab  map[string]float64
	ratesErr  error
)

// Rates returns units of each currency per USD.
func Rates() (map[string]float64, error) {
	ratesOnce.Do(func() { ratesTab, ratesErr = loadRates() })
	return ratesTab, ratesErr
}

func loadRates() (map[string]float64, error) {
	p, err := paths.Data("rates.csv")
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
	out := map[string]float64{}
	for _, r := range rows[1:] {
		v, err := strconv.ParseFloat(r[1], 64)
		if err != nil {
			return nil, err
		}
		out[r[0]] = v
	}
	return out, nil
}

// Convert converts m into currency to.
func Convert(m money.Money, to string) (money.Money, error) {
	table, err := Rates()
	if err != nil {
		return money.Money{}, err
	}
	from, ok1 := table[m.Currency]
	dst, ok2 := table[to]
	if !ok1 || !ok2 {
		return money.Money{}, fmt.Errorf("unknown currency %s->%s", m.Currency, to)
	}
	usd := float64(m.Cents) / from
	return money.In(money.RoundHalfUp(usd*dst), to), nil
}
