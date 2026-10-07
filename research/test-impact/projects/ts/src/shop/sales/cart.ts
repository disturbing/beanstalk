import { find, type Product } from "../catalog/products.ts";
import { type Money, zero } from "../core/money.ts";

export class Line {
  product: Product;
  qty: number;

  constructor(product: Product, qty: number) {
    this.product = product;
    this.qty = qty;
  }

  get total(): Money {
    return this.product.price.times(this.qty);
  }
}

export class Cart {
  lines = new Map<string, Line>();

  add(sku: string, qty = 1): void {
    if (qty <= 0) throw new RangeError("qty must be positive");
    const line = this.lines.get(sku);
    if (line) line.qty += qty;
    else this.lines.set(sku, new Line(find(sku), qty));
  }

  remove(sku: string): void {
    this.lines.delete(sku);
  }

  subtotal(): Money {
    let total = zero();
    for (const line of this.lines.values()) total = total.add(line.total);
    return total;
  }

  weightG(): number {
    let g = 0;
    for (const l of this.lines.values()) g += l.product.weightG * l.qty;
    return g;
  }

  count(): number {
    let n = 0;
    for (const l of this.lines.values()) n += l.qty;
    return n;
  }
}
