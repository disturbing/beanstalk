import json
from pathlib import Path

from shop.sales.cart import Cart

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


def cart_of(**qty: int) -> Cart:
    cart = Cart()
    for sku, n in qty.items():
        cart.add(sku.replace("_", "-"), n)
    return cart


def fixture_orders() -> list[dict]:
    with open(FIXTURES / "orders.json") as f:
        return json.load(f)
