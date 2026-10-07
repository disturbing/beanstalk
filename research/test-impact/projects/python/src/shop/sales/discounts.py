from shop import config
from shop.core.money import Money, zero
from shop.sales.cart import Cart


def percent_off(cart: Cart, pct: int) -> Money:
    cap = config.get("max_discount_pct", 100)
    return cart.subtotal().pct(min(pct, cap) / 100)


def threshold_off(cart: Cart, over_cents: int, off_cents: int) -> Money:
    if cart.subtotal().cents >= over_cents:
        return Money(off_cents)
    return zero()


def bogo(cart: Cart, sku: str) -> Money:
    line = cart.lines.get(sku)
    if not line:
        return zero()
    return line.product.price.times(line.qty // 2)
