import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Coupon } from '../types.ts';
import { allocateDiscount, couponDiscount, validateCoupon } from './discounts.ts';

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

describe('discounts', () => {
  it('takes a percentage or a fixed amount off', () => {
    assert.equal(couponDiscount(coupon({ value: 15 }), 2000), 300);
    assert.equal(couponDiscount(coupon({ kind: 'fixed', value: 500 }), 2000), 500);
  });

  it('enforces the minimum subtotal', () => {
    const c = coupon({ minSubtotal: 2000 });
    assert.equal(validateCoupon(c, 2000, 'USD'), c);
    assert.throws(() => validateCoupon(c, 1999, 'USD'), /at least \$20\.00/);
  });

  it('splits a discount across lines in proportion to their value', () => {
    assert.deepEqual(allocateDiscount([1000, 3000], 400), [100, 300]);
    assert.deepEqual(allocateDiscount([0, 0], 400), [0, 0]);
  });
});
