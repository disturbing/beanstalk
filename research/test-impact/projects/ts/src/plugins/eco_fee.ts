import { Money } from "../shop/core/money.ts";

export function fee(_base: Money): Money {
  return new Money(25);
}
