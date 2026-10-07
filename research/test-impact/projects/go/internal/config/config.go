// Package config reads config/app.json from the module root.
package config

import (
	"encoding/json"
	"os"
	"sync"

	"shop/internal/paths"
)

var (
	once sync.Once
	data map[string]any
	err  error
)

// Load returns the parsed config.
func Load() (map[string]any, error) {
	once.Do(func() {
		var p string
		p, err = paths.Config("app.json")
		if err != nil {
			return
		}
		var raw []byte
		raw, err = os.ReadFile(p)
		if err != nil {
			return
		}
		err = json.Unmarshal(raw, &data)
	})
	return data, err
}

// Get returns a raw value or def when missing (or config unreadable).
func Get(key string, def any) any {
	m, e := Load()
	if e != nil {
		return def
	}
	if v, ok := m[key]; ok {
		return v
	}
	return def
}

// String returns a string setting.
func String(key, def string) string {
	if s, ok := Get(key, def).(string); ok {
		return s
	}
	return def
}

// Number returns a numeric setting.
func Number(key string, def float64) float64 {
	if f, ok := Get(key, def).(float64); ok {
		return f
	}
	return def
}

// Strings returns a list-of-strings setting.
func Strings(key string) []string {
	list, _ := Get(key, nil).([]any)
	out := make([]string, 0, len(list))
	for _, v := range list {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
	}
	return out
}
