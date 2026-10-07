// Package plugins is a registry of fee plugins selected by name from config.
package plugins

import (
	"fmt"
	"sort"
	"sync"

	"shop/internal/config"
	"shop/internal/money"
)

// Fee computes a fee on a base amount.
type Fee func(base money.Money) money.Money

var (
	mu       sync.RWMutex
	registry = map[string]Fee{}
)

// Register adds a plugin; plugin packages call it from init().
func Register(name string, fn Fee) {
	mu.Lock()
	defer mu.Unlock()
	registry[name] = fn
}

// Load returns the plugin registered under name.
func Load(name string) (Fee, error) {
	mu.RLock()
	defer mu.RUnlock()
	fn, ok := registry[name]
	if !ok {
		return nil, fmt.Errorf("no fee plugin %q", name)
	}
	return fn, nil
}

// Names lists registered plugins.
func Names() []string {
	mu.RLock()
	defer mu.RUnlock()
	out := make([]string, 0, len(registry))
	for k := range registry {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// TotalFees sums the fees of every plugin enabled in config fee_plugins.
func TotalFees(base money.Money) (money.Money, error) {
	total := money.Zero("USD")
	for _, name := range config.Strings("fee_plugins") {
		fn, err := Load(name)
		if err != nil {
			return money.Money{}, err
		}
		total = total.Add(fn(base))
	}
	return total, nil
}
