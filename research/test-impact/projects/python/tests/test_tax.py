from shop.core.money import Money
from shop.sales.tax import rate, tax_on


def test_default_region_from_config():
    assert rate() == 0.0725


def test_regions():
    assert rate("OR") == 0.0
    assert tax_on(Money(10000), "TX") == Money(625)
