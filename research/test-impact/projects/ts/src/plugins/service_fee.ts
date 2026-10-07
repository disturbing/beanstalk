import type { Money } from "../shop/core/money.ts";

export const RATE = 0.02;

export function fee(base: Money): Money {
  return base.pct(RATE);
}
