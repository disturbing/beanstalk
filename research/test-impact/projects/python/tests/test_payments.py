from shop.billing.payments import charge, luhn_ok
from shop.core.money import Money


def test_luhn():
    assert luhn_ok("4539 1488 0343 6467")
    assert not luhn_ok("4539 1488 0343 6468")
    assert not luhn_ok("1234")


def test_charge():
    assert charge("4539148803436467", Money(100)) == "approved"
    assert charge("4539148803436468", Money(100)) == "rejected:card"
    assert charge("4539148803436467", Money(0)) == "rejected:amount"
