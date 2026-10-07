import json
from functools import lru_cache

from shop import config
from shop.core.money import Money, zero
from shop.paths import DATA
from shop.sales.cart import Cart


@lru_cache(maxsize=1)
def zones() -> dict:
    with open(DATA / "shipping_zones.json") as f:
        return json.load(f)


def cost(cart: Cart, zone: str = "domestic") -> Money:
    if cart.count() == 0:
        return zero()
    if zone == "domestic" and cart.subtotal().cents >= config.get("free_shipping_over", 10**9) * 100:
        return zero()
    z = zones()[zone]
    kg = -(-cart.weight_g() // 1000)
    return Money(z["base_cents"] + z["per_kg_cents"] * kg)
