import csv
from dataclasses import dataclass
from functools import lru_cache

from shop.core.money import Money
from shop.paths import DATA
from shop.util.validation import is_sku, require


@dataclass(frozen=True)
class Product:
    sku: str
    name: str
    price: Money
    weight_g: int
    category: str


@lru_cache(maxsize=1)
def catalog() -> dict[str, Product]:
    out = {}
    with open(DATA / "catalog.csv") as f:
        for row in csv.DictReader(f):
            require(is_sku(row["sku"]), f"bad sku {row['sku']}")
            out[row["sku"]] = Product(row["sku"], row["name"], Money(int(row["price_cents"])),
                                      int(row["weight_g"]), row["category"])
    return out


def find(sku: str) -> Product:
    try:
        return catalog()[sku]
    except KeyError:
        raise KeyError(f"no product {sku}") from None


def by_category(category: str) -> list[Product]:
    return sorted((p for p in catalog().values() if p.category == category), key=lambda p: p.sku)
