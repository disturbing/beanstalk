from helpers.factories import cart_of
from shop.fulfil.shipping import cost
from shop.sales.cart import Cart


def test_empty_cart_ships_free():
    assert cost(Cart()).cents == 0


def test_domestic_by_weight():
    assert cost(cart_of(SKU_002=1)).cents == 500 + 150 * 2


def test_free_over_threshold():
    assert cost(cart_of(SKU_006=3)).cents == 0


def test_intl():
    assert cost(cart_of(SKU_001=1), "intl").cents == 1500 + 600
