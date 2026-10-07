package storage

import (
	"slices"
	"strings"
	"testing"

	"shop/internal/events"
)

func TestStorageBusAndRepo(t *testing.T) {
	bus, repo := events.NewBus(), NewRepo[string]()
	bus.On("t", func(p string) { repo.Put(p, strings.ToUpper(p)) })
	bus.Emit("t", "b")
	bus.Emit("t", "a")
	if got := repo.All(); !slices.Equal(got, []string{"A", "B"}) {
		t.Fatalf("got %v", got)
	}
}
