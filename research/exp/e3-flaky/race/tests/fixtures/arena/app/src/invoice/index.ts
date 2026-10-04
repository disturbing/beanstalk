import type { LineItem } from "../cart/index.ts";
import { formatCents } from "../money/index.ts";

/** One printable line per cart item. */
export function invoiceLines(items: LineItem[]): string[] {
  return items.map((item) => `${item.qty} x ${item.sku} @ ${formatCents(item.priceCents)}`);
}
