import pytest

from shop.core.money import Money, round_half_up, zero


def test_add_and_sub():
    assert Money(150) + Money(250) == Money(400)
    assert Money(500) - Money(120) == Money(380)


def test_currency_mismatch():
    with pytest.raises(ValueError):
        Money(1, "USD") + Money(1, "EUR")


def test_pct_rounds_half_up():
    assert Money(1000).pct(0.0725) == Money(73)
    assert round_half_up(2.5) == 3
    assert round_half_up(-2.5) == -3


def test_format():
    assert Money(123456).format() == "1234.56 USD"
    assert Money(-5).format() == "-0.05 USD"
    assert zero("EUR").format() == "0.00 EUR"
