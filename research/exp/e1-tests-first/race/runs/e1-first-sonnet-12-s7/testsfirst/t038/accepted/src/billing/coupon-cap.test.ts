import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addCoupon, createTestApp, ON_ADDRESS, placeOrder } from '../lib/testing.ts';
import { couponDiscount } from './coupons.ts';
import { buildInvoice } from './invoice.ts';
import type { Coupon } from '../types.ts';

const fixed = (value: number): Coupon => ({
  id: 'BIG',
  kind: 'fixed',
  value,
  minSubtotal: 0,
  expiresAt: null,
  maxRedemptions: null,
  redemptions: 0,
});

describe('fixed coupons are capped at the subtotal', () => {
  it('couponDiscount never exceeds the subtotal', () => {
    assert.equal(couponDiscount(fixed(5000), 3000), 3000);
    assert.equal(couponDiscount(fixed(5000), 5000), 5000);
    assert.equal(couponDiscount(fixed(500), 3000), 500);
  });

  it('buildInvoice gives a zero total and no tax when the coupon exceeds the cart', () => {
    const app = createTestApp();
    const invoice = buildInvoice(app.ctx, {
      orderId: 'ord_0001',
      userId: 'usr_0001',
      address: ON_ADDRESS,
      items: [{ productId: 'prd_0001', description: 'Thing', quantity: 1, unitPrice: 3000, taxClass: 'standard' }],
      coupon: fixed(5000),
    });
    assert.equal(invoice.subtotal, 3000);
    assert.equal(invoice.discount, 3000);
    assert.equal(invoice.tax, 0);
    assert.equal(invoice.total, 0);
    for (const line of invoice.lines) {
      assert.ok(line.discount <= line.net);
      assert.equal(line.tax, 0);
    }
  });

  it('checkout of a $30 cart with a $50 coupon yields a zero order and invoice', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'FIFTY', kind: 'fixed', value: 5000 });
    const { order } = placeOrder(app, { price: 3000, couponCode: 'FIFTY' });
    assert.equal(order.subtotal, 3000);
    assert.equal(order.discount, 3000);
    assert.equal(order.tax, 0);
    assert.equal(order.total, 0);
    const invoice = app.ctx.store.invoices.findOne((i) => i.orderId === order.id);
    assert.ok(invoice);
    assert.equal(invoice.tax, 0);
    assert.equal(invoice.total, 0);
  });
});
