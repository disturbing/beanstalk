import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addCoupon, createTestApp, placeOrder, US_ADDRESS } from '../lib/testing.ts';
import { formatMoney } from '../lib/money.ts';
import type { Order } from '../types.ts';

describe('order total includes shipping', () => {
  it('is goods after discount, plus tax, plus shipping', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'TENOFF', value: 10 });
    const { order } = placeOrder(app, { price: 5000, quantity: 2, couponCode: 'TENOFF' });
    assert.ok(order.shippingCost > 0);
    assert.ok(order.tax > 0);
    assert.ok(order.discount > 0);
    assert.equal(order.total, order.subtotal - order.discount + order.tax + order.shippingCost);
  });

  it('includes shipping when there is no tax or discount', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { price: 3000, address: US_ADDRESS });
    assert.ok(order.shippingCost > 0);
    assert.equal(order.total, order.subtotal - order.discount + order.tax + order.shippingCost);
  });

  it('keeps the other amounts and leaves shipping out of the invoice', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { price: 2500, quantity: 3 });
    const invoice = app.ctx.store.invoices.require(order.invoiceId!);
    assert.equal(order.subtotal, invoice.subtotal);
    assert.equal(order.discount, invoice.discount);
    assert.equal(order.tax, invoice.tax);
    assert.equal(invoice.total, invoice.subtotal - invoice.discount + invoice.tax);
    assert.equal(order.total, invoice.total + order.shippingCost);
  });

  it('returns the full total when the order is fetched', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app);
    const fetched = app.call('GET', `/orders/${order.id}`, { token }).body as Order;
    assert.equal(fetched.total, order.subtotal - order.discount + order.tax + order.shippingCost);
  });

  it('shows the new total in the confirmation email', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { price: 4000 });
    const expected = order.subtotal - order.discount + order.tax + order.shippingCost;
    assert.equal(order.total, expected);
    const mail = app.mailer.sent.find((m) => m.subject === `Order ${order.number} confirmed`);
    assert.ok(mail, 'confirmation email was sent');
    assert.ok(
      mail.body.includes(`Total: ${formatMoney(expected, 'USD')}`),
      `email should show total ${formatMoney(expected, 'USD')}, got: ${mail.body}`,
    );
  });
});
