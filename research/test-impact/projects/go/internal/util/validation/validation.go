// Package validation has format checks.
package validation

import (
	"errors"
	"regexp"
)

var (
	skuRE   = regexp.MustCompile(`^SKU-\d{3}$`)
	emailRE = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[a-z]{2,}$`)
)

// IsSKU reports whether value looks like SKU-123.
func IsSKU(value string) bool { return skuRE.MatchString(value) }

// IsEmail reports whether value looks like an email address.
func IsEmail(value string) bool { return emailRE.MatchString(value) }

// Require returns an error carrying message when cond is false.
func Require(cond bool, message string) error {
	if !cond {
		return errors.New(message)
	}
	return nil
}
