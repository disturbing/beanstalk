import { type Money, zero } from "../core/money.ts";
import type { Order } from "../fulfil/orders.ts";

export function revenue(orders: Order[]): Money {
  let total = zero();
  for (const o of orders) if (o.state !== "cancelled") total = total.add(o.quote.total);
  return total;
}

export function topSkus(orders: Order[], n = 3): [string, number][] {
  const c = new Map<string, number>();
  for (const o of orders) for (const [sku, line] of o.cart.lines) c.set(sku, (c.get(sku) ?? 0) + line.qty);
  return [...c.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, n);
}
