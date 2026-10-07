export class OutOfStock extends Error {
  constructor(sku: string) {
    super(sku);
    this.name = "OutOfStock";
  }
}

export class Inventory {
  levels: Record<string, number>;
  reserved: Record<string, number> = {};

  constructor(levels: Record<string, number> = {}) {
    this.levels = { ...levels };
  }

  available(sku: string): number {
    return (this.levels[sku] ?? 0) - (this.reserved[sku] ?? 0);
  }

  reserve(sku: string, qty: number): void {
    if (qty <= 0) throw new RangeError("qty must be positive");
    if (this.available(sku) < qty) throw new OutOfStock(sku);
    this.reserved[sku] = (this.reserved[sku] ?? 0) + qty;
  }

  release(sku: string, qty: number): void {
    this.reserved[sku] = Math.max(0, (this.reserved[sku] ?? 0) - qty);
  }

  commit(sku: string, qty: number): void {
    this.release(sku, qty);
    this.levels[sku] = (this.levels[sku] ?? 0) - qty;
  }
}
