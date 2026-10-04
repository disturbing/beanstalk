import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase, runMigrations } from '../db/migrate.ts';
import { migrations } from '../db/migrations/index.ts';
import { Store } from '../db/store.ts';
import { addCoupon, createTestApp, placeOrder } from '../lib/testing.ts';
import type { Coupon } from '../types.ts';
import { couponDiscount } from './discounts.ts';

const coupon = (overrides: Partial<Coupon> = {}): Coupon =>
  ({
    id: 'TEST',
    kind: 'percent',
    value: 20,
    minSubtotal: 0,
    expiresAt: null,
    maxRedemptions: null,
    redemptions: 0,
    maxDiscount: null,
    ...overrides,
  }) as Coupon;

describe('coupon discount cap', () => {
  it('limits a percentage discount to maxDiscount', () => {
    assert.equal(couponDiscount(coupon({ maxDiscount: 2500 }), 50000), 2500);
  });

  it('does not change a percentage discount below the cap', () => {
    assert.equal(couponDiscount(coupon({ maxDiscount: 2500 }), 10000), 2000);
  });

  it('allows a discount exactly equal to the cap', () => {
    assert.equal(couponDiscount(coupon({ maxDiscount: 2000 }), 10000), 2000);
  });

  it('does not cap a percentage coupon whose maxDiscount is null', () => {
    assert.equal(couponDiscount(coupon({ maxDiscount: null }), 50000), 10000);
  });

  it('has no effect on fixed-amount coupons', () => {
    assert.equal(couponDiscount(coupon({ kind: 'fixed', value: 500, maxDiscount: 100 }), 5000), 500);
  });

  it('applies the cap at checkout', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'BIG20', value: 20, maxDiscount: 2500 });
    const { order } = placeOrder(app, { couponCode: 'BIG20', price: 50000 });
    assert.equal(order.discount, 2500);
  });

  it('leaves checkout discounts below the cap untouched', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'BIG20', value: 20, maxDiscount: 2500 });
    const { order } = placeOrder(app, { couponCode: 'BIG20', price: 10000 });
    assert.equal(order.discount, 2000);
  });

  it('gives existing seeded coupons no cap', () => {
    const store = openDatabase();
    assert.equal(store.coupons.require('WELCOME10').maxDiscount, null);
    assert.equal(store.coupons.require('FIVEOFF').maxDiscount, null);
  });

  it('adds a migration after the existing ones that backfills null on existing coupons', () => {
    const existing = migrations.filter((m) => m.version <= 6);
    const added = migrations.filter((m) => m.version > 6);
    assert.ok(added.length >= 1, 'expected a migration with a version above 6');
    const store = new Store();
    runMigrations(store, existing);
    store.coupons.insert({
      id: 'OLD',
      kind: 'percent',
      value: 30,
      minSubtotal: 0,
      expiresAt: null,
      maxRedemptions: null,
      redemptions: 0,
    });
    const ran = runMigrations(store);
    assert.deepEqual(
      ran,
      added.map((m) => m.version),
    );
    assert.equal(store.coupons.require('OLD').maxDiscount, null);
    assert.equal(store.coupons.require('WELCOME10').maxDiscount, null);
  });

  it('gives coupons inserted without a cap a null maxDiscount', () => {
    const app = createTestApp();
    const inserted = addCoupon(app.ctx, { id: 'PLAIN' });
    assert.equal(inserted.maxDiscount, null);
  });
});
