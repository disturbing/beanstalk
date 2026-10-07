// Package payments validates cards and charges amounts.
package payments

import "shop/internal/money"

// LuhnOK checks the Luhn digit of number, ignoring non-digits.
func LuhnOK(number string) bool {
	var digits []int
	for _, r := range number {
		if r >= '0' && r <= '9' {
			digits = append(digits, int(r-'0'))
		}
	}
	if len(digits) < 12 {
		return false
	}
	total := 0
	for i := 0; i < len(digits); i++ {
		d := digits[len(digits)-1-i]
		if i%2 == 1 {
			d *= 2
			if d > 9 {
				d -= 9
			}
		}
		total += d
	}
	return total%10 == 0
}

// Charge returns "approved" or "rejected:<reason>".
func Charge(card string, amount money.Money) string {
	if amount.Cents <= 0 {
		return "rejected:amount"
	}
	if !LuhnOK(card) {
		return "rejected:card"
	}
	return "approved"
}
