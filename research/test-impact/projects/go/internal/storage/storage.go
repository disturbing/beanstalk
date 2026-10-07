// Package storage is an in-memory keyed repository.
package storage

import "sort"

// Repo stores values by key.
type Repo[T any] struct {
	rows map[string]T
}

// NewRepo returns an empty repo.
func NewRepo[T any]() *Repo[T] { return &Repo[T]{rows: map[string]T{}} }

// Put stores value under key.
func (r *Repo[T]) Put(key string, value T) { r.rows[key] = value }

// Get returns the value under key.
func (r *Repo[T]) Get(key string) (T, bool) {
	v, ok := r.rows[key]
	return v, ok
}

// All returns values ordered by key.
func (r *Repo[T]) All() []T {
	keys := make([]string, 0, len(r.rows))
	for k := range r.rows {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]T, len(keys))
	for i, k := range keys {
		out[i] = r.rows[k]
	}
	return out
}
