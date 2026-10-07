// Package coupons parses coupon codes.
package coupons

import (
	"fmt"
	"strconv"
	"strings"
)

// Coupon is a parsed code.
type Coupon struct {
	Kind  string
	Value int64
}

// Parse understands PCTnn, OFFnn and FREESHIP.
func Parse(code string) (Coupon, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	switch {
	case strings.HasPrefix(code, "PCT"):
		n, err := strconv.ParseInt(code[3:], 10, 64)
		if err != nil {
			return Coupon{}, fmt.Errorf("unknown coupon %s", code)
		}
		return Coupon{"percent", n}, nil
	case strings.HasPrefix(code, "OFF"):
		n, err := strconv.ParseInt(code[3:], 10, 64)
		if err != nil {
			return Coupon{}, fmt.Errorf("unknown coupon %s", code)
		}
		return Coupon{"amount", n * 100}, nil
	case code == "FREESHIP":
		return Coupon{"shipping", 0}, nil
	}
	return Coupon{}, fmt.Errorf("unknown coupon %s", code)
}
