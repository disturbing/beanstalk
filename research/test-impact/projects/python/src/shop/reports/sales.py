from collections import Counter

from shop.core.money import Money, zero
from shop.fulfil.orders import Order


def revenue(orders: list[Order]) -> Money:
    total = zero()
    for o in orders:
        if o.state != "cancelled":
            total = total + o.quote.total
    return total


def top_skus(orders: list[Order], n: int = 3) -> list[tuple[str, int]]:
    c: Counter[str] = Counter()
    for o in orders:
        for sku, line in o.cart.lines.items():
            c[sku] += line.qty
    return sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[:n]
