package ids

import (
	"strings"
	"testing"
)

func TestIDsSequence(t *testing.T) {
	s := NewSequence("X", 9)
	if a, b := s.Take(), s.Take(); a != "X00009" || b != "X00010" {
		t.Fatalf("got %s %s", a, b)
	}
}

func TestIDsShortIDStable(t *testing.T) {
	if ShortID("c", "a", 1) != ShortID("c", "a", 1) {
		t.Fatal("not stable")
	}
	if !strings.HasPrefix(ShortID("c", "a", 1), "c-") {
		t.Fatal("prefix")
	}
}
