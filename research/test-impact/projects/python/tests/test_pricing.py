from helpers.factories import cart_of
from shop.sales.pricing import quote


def test_plain_quote():
    q = quote(cart_of(SKU_001=2))
    assert q.subtotal.cents == 2400
    assert q.shipping.cents == 650
    assert q.fees.cents == 48
    assert q.tax.cents == 174
    assert q.total.cents == 2400 + 650 + 48 + 174


def test_percent_coupon():
    q = quote(cart_of(SKU_002=1), "PCT10")
    assert q.discount.cents == 350
    assert q.tax.cents == 228


def test_freeship_coupon():
    q = quote(cart_of(SKU_004=1), "FREESHIP", region="OR")
    assert q.shipping.cents == 0
    assert q.tax.cents == 0
