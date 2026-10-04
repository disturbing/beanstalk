import assert from 'node:assert/strict';
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
  it('exports validateCoupon and couponDiscount', () => {
    assert.equal(typeof coupons.validateCoupon, 'function');
    assert.equal(typeof coupons.couponDiscount, 'function');
  });

  it('takes a percentage or a fixed amount off', () => {
    assert.equal(coupons.couponDiscount(coupon({ value: 15 }), 2000), 300);
    assert.equal(coupons.couponDiscount(coupon({ kind: 'fixed', value: 500 }), 2000), 500);
  });

  it('returns the coupon when the subtotal meets the minimum', () => {
    const c = coupon({ minSubtotal: 1000 });
    assert.equal(coupons.validateCoupon(c, 1000, 'CAD'), c);
  });

  it('rejects a subtotal below the minimum with the existing message', () => {
    const c = coupon({ id: 'BIG', minSubtotal: 5000 });
    assert.throws(
      () => coupons.validateCoupon(c, 1000, 'CAD'),
      (err: Error) => /coupon BIG needs a subtotal of at least /.test(err.message),
    );
  });

  it('is still re-exported from discounts.ts as the same functions', () => {
    assert.equal(discounts.validateCoupon, coupons.validateCoupon);
    assert.equal(discounts.couponDiscount, coupons.couponDiscount);
  });

  it('leaves allocateDiscount in discounts.ts', () => {
    assert.equal(typeof discounts.allocateDiscount, 'function');
    assert.equal('allocateDiscount' in coupons, false);
    assert.deepEqual(discounts.allocateDiscount([1000, 3000], 400), [100, 300]);
  });
});
