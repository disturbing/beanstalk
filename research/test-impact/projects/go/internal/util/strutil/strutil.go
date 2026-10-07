// Package strutil has small string helpers.
package strutil

import (
	"regexp"
	"strings"
)

var nonAlnum = regexp.MustCompile(`[^a-z0-9]+`)

// Slugify lowercases and joins alphanumeric runs with '-'.
func Slugify(text string) string {
	return strings.Trim(nonAlnum.ReplaceAllString(strings.ToLower(text), "-"), "-")
}

// PadRight truncates to width then pads with spaces on the right.
func PadRight(text string, width int) string {
	r := truncate(text, width)
	return r + strings.Repeat(" ", width-len([]rune(r)))
}

// PadLeft truncates to width then pads with spaces on the left.
func PadLeft(text string, width int) string {
	r := truncate(text, width)
	return strings.Repeat(" ", width-len([]rune(r))) + r
}

func truncate(text string, width int) string {
	r := []rune(text)
	if len(r) > width {
		r = r[:width]
	}
	return string(r)
}
