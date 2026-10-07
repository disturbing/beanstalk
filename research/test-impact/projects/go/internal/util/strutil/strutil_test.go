package strutil

import "testing"

func TestStrutilSlugify(t *testing.T) {
	if got := Slugify("Desk Lamp (Large)!"); got != "desk-lamp-large" {
		t.Fatalf("got %q", got)
	}
}

func TestStrutilPads(t *testing.T) {
	if PadRight("ab", 4) != "ab  " || PadLeft("ab", 4) != "  ab" || PadRight("abcdef", 3) != "abc" {
		t.Fatal("pads")
	}
}
