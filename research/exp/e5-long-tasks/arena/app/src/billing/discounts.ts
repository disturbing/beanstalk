import { badRequest } from '../lib/errors.ts';
import { formatMoney, percentOf, sumCents } from '../lib/money.ts';
import type { Cents, Coupon, Currency } from '../types.ts';

/** Check that `coupon` may be used on a cart worth `subtotal`. Returns the coupon for chaining. */
export function validateCoupon(coupon: Coupon, subtotal: Cents, currency: Currency): Coupon {
  if (subtotal < coupon.minSubtotal) {
    throw badRequest(`coupon ${coupon.id} needs a subtotal of at least ${formatMoney(coupon.minSubtotal, currency)}`);
  }
  return coupon;
}

/** How much `coupon` takes off a cart worth `subtotal`. */
export function couponDiscount(coupon: Coupon, subtotal: Cents): Cents {
  return coupon.kind === 'percent' ? percentOf(subtotal, coupon.value) : coupon.value;
}

/** Spread a cart-level discount over the lines in proportion to their value. */
export function allocateDiscount(nets: Cents[], discount: Cents): Cents[] {
  const subtotal = sumCents(nets);
  if (subtotal === 0) return nets.map(() => 0);
  return nets.map((net) => Math.floor((discount * net) / subtotal));
}
