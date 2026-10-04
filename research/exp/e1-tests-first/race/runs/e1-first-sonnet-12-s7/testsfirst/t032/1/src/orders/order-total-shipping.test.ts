import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatMoney } from '../lib/money.ts';
import { addCoupon, createTestApp, placeOrder, US_ADDRESS } from '../lib/testing.ts';
import type { Invoice, Order } from '../types.ts';

function expectedTotal(order: Order): number {
  return order.subtotal - order.discount + order.tax + order.shippingCost;
}

describe('order total includes shipping', () => {
  it('is goods after discount, plus tax, plus shipping', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { price: 5000, quantity: 2 });
    assert.ok(order.shippingCost > 0);
    assert.ok(order.tax > 0);
    assert.equal(order.total, expectedTotal(order));
  });

  it('includes shipping when a coupon discount applies', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'SHIPTEST' });
    const { order } = placeOrder(app, { price: 5000, quantity: 2, couponCode: 'SHIPTEST' });
    assert.ok(order.discount > 0);
    assert.equal(order.total, expectedTotal(order));
  });

  it('includes shipping for international destinations', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { address: US_ADDRESS });
    assert.ok(order.shippingCost > 0);
    assert.equal(order.total, expectedTotal(order));
  });

  it('is the same when the order is fetched again', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app);
    const fetched = app.call('GET', `/orders/${order.id}`, { token }).body as Order;
    assert.equal(fetched.shippingCost, order.shippingCost);
    assert.equal(fetched.total, expectedTotal(order));
  });

  it('leaves the invoice without shipping', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app, { price: 5000 });
    const invoice = app.call('GET', `/orders/${order.id}/invoice`, { token }).body as Invoice;
    assert.equal(invoice.total, order.subtotal - order.discount + order.tax);
    assert.equal(order.total, invoice.total + order.shippingCost);
  });

  it('shows the new order total in the confirmation email', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { price: 5000 });
    const mail = app.mailer.sent.find((m) => m.subject.includes(order.number));
    assert.ok(mail);
    assert.equal(order.total, expectedTotal(order));
    assert.ok(mail.body.includes(`Total: ${formatMoney(order.total)}`), mail.body);
  });
});
