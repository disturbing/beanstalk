import pytest

from shop.core.currency import convert, rates
from shop.core.money import Money


def test_rates_loaded():
    assert rates()["EUR"] == 0.9
    assert len(rates()) == 5


def test_convert_usd_to_jpy():
    assert convert(Money(1000), "JPY") == Money(150000, "JPY")


def test_convert_round_trip():
    eur = convert(Money(1000), "EUR")
    assert eur == Money(900, "EUR")
    assert convert(eur, "USD") == Money(1000)


def test_unknown_currency():
    with pytest.raises(KeyError):
        convert(Money(1), "XXX")
