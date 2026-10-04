export interface LineItem {
  sku: string;
  priceCents: number;
  qty: number;
}

/** Number of units in the cart. */
export function itemCount(items: LineItem[]): number {
  return items.reduce((n, item) => n + item.qty, 0);
}

/** Amount the customer pays, in cents. */
export function total(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + item.priceCents * item.qty, 0);
}
