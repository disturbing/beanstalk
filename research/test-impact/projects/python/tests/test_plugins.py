from shop import plugins
from shop.core.money import Money


def test_configured_fees():
    assert plugins.total_fees(Money(10000)).cents == 200


def test_load_by_name():
    assert plugins.load("service_fee").fee(Money(500)).cents == 10
