import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Coupon, Invoice } from '../types.ts';
import { addCoupon, createTestApp, placeOrder } from '../lib/testing.ts';
import { couponDiscount } from './discounts.ts';

function invoiceFor(app: ReturnType<typeof createTestApp>, orderId: string, token: string): Invoice {
  const res = app.call('GET', `/orders/${orderId}/invoice`, { token });
  assert.equal(res.status, 200);
  return res.body as Invoice;
}

describe('fixed coupon cap', () => {
  it('never discounts more than the subtotal', () => {
    const c: Coupon = {
      id: 'T',
      kind: 'fixed',
      value: 5000,
      minSubtotal: 0,
      expiresAt: null,
      maxRedemptions: null,
      redemptions: 0,
    };
    assert.equal(couponDiscount(c, 3000), 3000);
    assert.equal(couponDiscount(c, 8000), 5000);
  });

  it('gives a fully discounted invoice with no tax and a zero total', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'FIFTY', kind: 'fixed', value: 5000 });
    const { order, token } = placeOrder(app, { price: 3000, couponCode: 'FIFTY' });
    assert.equal(order.subtotal, 3000);
    assert.equal(order.discount, 3000);
    assert.equal(order.tax, 0);
    assert.equal(order.total, 0);

    const invoice = invoiceFor(app, order.id, token);
    assert.equal(invoice.subtotal, 3000);
    assert.equal(invoice.discount, 3000);
    assert.equal(invoice.tax, 0);
    assert.deepEqual(invoice.taxBreakdown, { federal: 0, regional: 0 });
    assert.equal(invoice.total, 0);
  });

  it('leaves a coupon smaller than the subtotal unchanged', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'FIVE', kind: 'fixed', value: 500 });
    const { order, token } = placeOrder(app, { price: 3000, couponCode: 'FIVE' });
    assert.equal(order.discount, 500);
    assert.ok(order.total > 0);
    const invoice = invoiceFor(app, order.id, token);
    assert.equal(invoice.discount, 500);
    assert.ok(invoice.tax > 0);
    assert.ok(invoice.total > 0);
  });
});
