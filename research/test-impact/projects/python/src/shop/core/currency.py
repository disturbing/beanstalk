import csv
from functools import lru_cache

from shop.core.money import Money, round_half_up
from shop.paths import DATA


@lru_cache(maxsize=1)
def rates() -> dict[str, float]:
    with open(DATA / "rates.csv") as f:
        return {row["code"]: float(row["per_usd"]) for row in csv.DictReader(f)}


def convert(m: Money, to: str) -> Money:
    table = rates()
    if m.currency not in table or to not in table:
        raise KeyError(f"unknown currency {m.currency}->{to}")
    usd = m.cents / table[m.currency]
    return Money(round_half_up(usd * table[to]), to)
