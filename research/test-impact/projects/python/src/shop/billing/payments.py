from shop.core.money import Money


def luhn_ok(number: str) -> bool:
    digits = [int(c) for c in number if c.isdigit()]
    if len(digits) < 12:
        return False
    total = 0
    for i, d in enumerate(reversed(digits)):
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def charge(card: str, amount: Money) -> str:
    if amount.cents <= 0:
        return "rejected:amount"
    if not luhn_ok(card):
        return "rejected:card"
    return "approved"
