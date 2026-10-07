class OutOfStock(Exception):
    pass


class Inventory:
    def __init__(self, levels: dict[str, int] | None = None):
        self.levels = dict(levels or {})
        self.reserved: dict[str, int] = {}

    def available(self, sku: str) -> int:
        return self.levels.get(sku, 0) - self.reserved.get(sku, 0)

    def reserve(self, sku: str, qty: int) -> None:
        if qty <= 0:
            raise ValueError("qty must be positive")
        if self.available(sku) < qty:
            raise OutOfStock(sku)
        self.reserved[sku] = self.reserved.get(sku, 0) + qty

    def release(self, sku: str, qty: int) -> None:
        self.reserved[sku] = max(0, self.reserved.get(sku, 0) - qty)

    def commit(self, sku: str, qty: int) -> None:
        self.release(sku, qty)
        self.levels[sku] = self.levels.get(sku, 0) - qty
