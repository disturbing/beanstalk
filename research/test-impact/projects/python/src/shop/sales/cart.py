from dataclasses import dataclass, field

from shop.catalog.products import Product, find
from shop.core.money import Money, zero


@dataclass
class Line:
    product: Product
    qty: int

    @property
    def total(self) -> Money:
        return self.product.price.times(self.qty)


@dataclass
class Cart:
    lines: dict[str, Line] = field(default_factory=dict)

    def add(self, sku: str, qty: int = 1) -> None:
        if qty <= 0:
            raise ValueError("qty must be positive")
        if sku in self.lines:
            self.lines[sku].qty += qty
        else:
            self.lines[sku] = Line(find(sku), qty)

    def remove(self, sku: str) -> None:
        self.lines.pop(sku, None)

    def subtotal(self) -> Money:
        total = zero()
        for line in self.lines.values():
            total = total + line.total
        return total

    def weight_g(self) -> int:
        return sum(l.product.weight_g * l.qty for l in self.lines.values())

    def count(self) -> int:
        return sum(l.qty for l in self.lines.values())
