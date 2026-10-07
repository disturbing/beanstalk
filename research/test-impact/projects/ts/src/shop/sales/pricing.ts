import { Money, zero } from "../core/money.ts";
import * as shipping from "../fulfil/shipping.ts";
import * as plugins from "../../plugins/index.ts";
import type { Cart } from "./cart.ts";
import { parse } from "./coupons.ts";
import * as discounts from "./discounts.ts";
import * as tax from "./tax.ts";

export class Quote {
  readonly subtotal: Money;
  readonly discount: Money;
  readonly shipping: Money;
  readonly fees: Money;
  readonly tax: Money;

  constructor(subtotal: Money, discount: Money, shipping: Money, fees: Money, tax: Money) {
    this.subtotal = subtotal;
    this.discount = discount;
    this.shipping = shipping;
    this.fees = fees;
    this.tax = tax;
    Object.freeze(this);
  }

  get total(): Money {
    return this.subtotal.sub(this.discount).add(this.shipping).add(this.fees).add(this.tax);
  }
}

export async function quote(
  cart: Cart,
  coupon: string | null = null,
  zone = "domestic",
  region: string | null = null,
): Promise<Quote> {
  const subtotal = cart.subtotal();
  let discount = zero();
  let ship = shipping.cost(cart, zone);
  if (coupon) {
    const c = parse(coupon);
    if (c.kind === "percent") discount = discounts.percentOff(cart, c.value);
    else if (c.kind === "amount") discount = new Money(Math.min(c.value, subtotal.cents));
    else if (c.kind === "shipping") ship = zero();
  }
  const fees = await plugins.totalFees(subtotal.sub(discount));
  const taxed = tax.taxOn(subtotal.sub(discount), region);
  return new Quote(subtotal, discount, ship, fees, taxed);
}
