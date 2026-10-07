from helpers.factories import cart_of


def test_subtotal():
    cart = cart_of(SKU_001=2, SKU_003=1)
    assert cart.subtotal().cents == 2850


def test_add_merges_lines():
    cart = cart_of(SKU_001=1)
    cart.add("SKU-001", 2)
    assert cart.count() == 3
    assert len(cart.lines) == 1


def test_remove_and_weight():
    cart = cart_of(SKU_002=1, SKU_005=2)
    assert cart.weight_g() == 1560
    cart.remove("SKU-002")
    assert cart.weight_g() == 360
