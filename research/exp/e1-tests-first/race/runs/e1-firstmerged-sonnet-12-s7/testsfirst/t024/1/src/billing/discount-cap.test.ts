import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase, runMigrations } from '../db/migrate.ts';
import { migrations } from '../db/migrations/index.ts';
import { Store } from '../db/store.ts';
import { addCoupon, createTestApp, placeOrder } from '../lib/testing.ts';
import type { Coupon } from '../types.ts';
import { couponDiscount } from './discounts.ts';

const coupon = (overrides: Record<string, unknown> = {}): Coupon =>
  ({
    id: 'TEST',
    kind: 'percent',
    value: 20,
    minSubtotal: 0,
    expiresAt: null,
    maxRedemptions: null,
    redemptions: 0,
    ...overrides,
  }) as Coupon;

describe('coupon maxDiscount', () => {
  it('caps a percentage discount at maxDiscount', () => {
    assert.equal(couponDiscount(coupon({ maxDiscount: 2500 }), 20000), 2500);
    assert.equal(couponDiscount(coupon({ value: 30, maxDiscount: 1000 }), 10000), 1000);
  });

  it('leaves a percentage discount under the cap alone', () => {
    const c = coupon({ maxDiscount: 2500 });
    assert.equal(couponDiscount(c, 10000), 2000);
    assert.equal(couponDiscount(c, 12500), 2500);
  });

  it('does not cap coupons with a null maxDiscount', () => {
    assert.equal(couponDiscount(coupon({ maxDiscount: null }), 1000000), 200000);
  });

  it('does not apply to fixed-amount coupons', () => {
    assert.equal(couponDiscount(coupon({ kind: 'fixed', value: 500, maxDiscount: 100 }), 2000), 500);
  });

  it('registers a new migration after the existing ones', () => {
    const versions = migrations.map((m) => m.version);
    assert.ok(versions.length >= 7);
    assert.deepEqual(versions, [...versions].sort((a, b) => a - b));
  });

  it('gives seeded coupons a null maxDiscount', () => {
    const store = openDatabase();
    assert.equal(store.coupons.require('WELCOME10').maxDiscount, null);
    assert.equal(store.coupons.require('FIVEOFF').maxDiscount, null);
  });

  it('backfills null on coupons that existed before the migration', () => {
    const store = new Store();
    runMigrations(store, migrations.filter((m) => m.version <= 6));
    assert.ok(!('maxDiscount' in store.coupons.require('WELCOME10')));
    const pending = migrations.filter((m) => m.version > 6).map((m) => m.version);
    assert.deepEqual(runMigrations(store), pending);
    assert.equal(store.coupons.require('WELCOME10').maxDiscount, null);
  });

  it('defaults to no cap for new coupons that do not set one', () => {
    const app = createTestApp();
    assert.equal(addCoupon(app.ctx, { id: 'PLAIN' }).maxDiscount, null);
  });

  it('applies the cap at checkout', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'TWENTYCAP', value: 20, maxDiscount: 2500 });
    const { order } = placeOrder(app, { couponCode: 'TWENTYCAP', price: 20000 });
    assert.equal(order.discount, 2500);
  });

  it('does not cap at checkout when the discount is under the cap', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'TWENTYCAP', value: 20, maxDiscount: 2500 });
    const { order } = placeOrder(app, { couponCode: 'TWENTYCAP', price: 5000 });
    assert.equal(order.discount, 1000);
  });
});
