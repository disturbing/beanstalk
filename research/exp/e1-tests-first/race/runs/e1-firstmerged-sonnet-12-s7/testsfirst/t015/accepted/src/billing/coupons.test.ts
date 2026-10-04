import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { Coupon } from '../types.ts';
import * as coupons from './coupons.ts';
import * as discounts from './discounts.ts';

const coupon = (overrides: Partial<Coupon> = {}): Coupon => ({
  id: 'TEST',
  kind: 'percent',
  value: 10,
  minSubtotal: 0,
  expiresAt: null,
  maxRedemptions: null,
  redemptions: 0,
  ...overrides,
});

describe('coupons module', () => {
  it('takes a percentage or a fixed amount off', () => {
    assert.equal(coupons.couponDiscount(coupon({ value: 15 }), 2000), 300);
    assert.equal(coupons.couponDiscount(coupon({ kind: 'fixed', value: 500 }), 2000), 500);
  });

  it('enforces the minimum subtotal', () => {
    const c = coupon({ minSubtotal: 2000 });
    assert.equal(coupons.validateCoupon(c, 2000, 'USD'), c);
    assert.throws(() => coupons.validateCoupon(c, 1999, 'USD'), /coupon TEST needs a subtotal of at least \$20\.00/);
  });

  it('is still re-exported from discounts.ts as the same functions', () => {
    assert.equal(discounts.validateCoupon, coupons.validateCoupon);
    assert.equal(discounts.couponDiscount, coupons.couponDiscount);
  });

  it('keeps allocateDiscount in discounts.ts only', () => {
    assert.deepEqual(discounts.allocateDiscount([1000, 3000], 400), [100, 300]);
    assert.equal('allocateDiscount' in coupons, false);
  });

  it('has the invoice code import the coupon functions from coupons.ts', () => {
    const source = readFileSync(new URL('./invoice.ts', import.meta.url), 'utf8');
    assert.match(source, /from '\.\/coupons\.ts'/);
  });
});
