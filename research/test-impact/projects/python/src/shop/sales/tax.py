import json
from functools import lru_cache

from shop import config
from shop.core.money import Money
from shop.paths import DATA


@lru_cache(maxsize=1)
def table() -> dict[str, float]:
    with open(DATA / "tax.json") as f:
        return json.load(f)


def rate(region: str | None = None) -> float:
    region = region or config.get("tax_region")
    return table()[region]


def tax_on(amount: Money, region: str | None = None) -> Money:
    return amount.pct(rate(region))
