import * as config from "../config.ts";
import { Money, zero } from "../core/money.ts";
import type { Cart } from "./cart.ts";

export function percentOff(cart: Cart, pct: number): Money {
  const cap = config.get<number>("max_discount_pct", 100);
  return cart.subtotal().pct(Math.min(pct, cap) / 100);
}

export function thresholdOff(cart: Cart, overCents: number, offCents: number): Money {
  if (cart.subtotal().cents >= overCents) return new Money(offCents);
  return zero();
}

export function bogo(cart: Cart, sku: string): Money {
  const line = cart.lines.get(sku);
  if (!line) return zero();
  return line.product.price.times(Math.floor(line.qty / 2));
}
