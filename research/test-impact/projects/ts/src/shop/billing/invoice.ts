import { padLeft, padRight } from "@shop/utils";
import * as config from "../config.ts";
import type { Money } from "../core/money.ts";
import type { Order } from "../fulfil/orders.ts";

export const WIDTH = 32;

export function render(order: Order): string {
  const rows = [`INVOICE ${order.id}`];
  const skus = [...order.cart.lines.keys()].sort();
  for (const sku of skus) {
    const line = order.cart.lines.get(sku)!;
    rows.push(padRight(`${line.qty} x ${line.product.name}`, 20) + padLeft(line.total.format(), 12));
  }
  const q = order.quote;
  const totals: [string, Money][] = [
    ["Subtotal", q.subtotal], ["Discount", q.discount], ["Shipping", q.shipping],
    ["Fees", q.fees], ["Tax", q.tax], ["Total", q.total],
  ];
  for (const [label, amount] of totals) rows.push(padRight(label, 20) + padLeft(amount.format(), 12));
  rows.push(config.get<string>("invoice_footer", ""));
  return rows.join("\n");
}
