from helpers.factories import cart_of
from shop.sales import discounts
from shop.sales.coupons import Coupon, parse


def test_percent_off_capped():
    cart = cart_of(SKU_002=2)
    assert discounts.percent_off(cart, 10).cents == 700
    assert discounts.percent_off(cart, 80).cents == 3500


def test_threshold():
    cart = cart_of(SKU_004=1)
    assert discounts.threshold_off(cart, 4000, 500).cents == 500
    assert discounts.threshold_off(cart, 5000, 500).cents == 0


def test_bogo():
    cart = cart_of(SKU_005=5)
    assert discounts.bogo(cart, "SKU-005").cents == 3600


def test_coupon_parse():
    assert parse(" pct15 ") == Coupon("percent", 15)
    assert parse("OFF7") == Coupon("amount", 700)
    assert parse("freeship") == Coupon("shipping", 0)
