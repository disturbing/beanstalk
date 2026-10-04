import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getInvoice } from '../billing/service.ts';
import { addProduct, createTestApp, errorMessage, placeOrder, signUp } from '../lib/testing.ts';

describe('checkout with an empty cart', () => {
  it('is rejected with 400 "cart is empty"', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx);
    const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
    assert.equal(res.status, 400);
    assert.equal(errorMessage(res), 'cart is empty');
  });

  it('is rejected as empty even when a coupon code is given', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx);
    const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0, couponCode: 'WHATEVER' } });
    assert.equal(res.status, 400);
    assert.equal(errorMessage(res), 'cart is empty');
  });

  it('creates no invoice and no order', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx);
    app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
    assert.equal(app.ctx.store.invoices.all().length, 0);
    assert.equal(app.ctx.store.orders.all().length, 0);
  });

  it('does not use up an invoice number or order number', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx, 'empty@example.com');
    app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
    app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
    const { order } = placeOrder(app, { email: 'real@example.com' });
    assert.equal(order.number, 'BS-0001');
    assert.match(getInvoice(app.ctx, order.invoiceId!).number, /-0001$/);
  });

  it('still lets a customer with items check out', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx);
    const product = addProduct(app.ctx);
    app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 1 } });
    const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
    assert.equal(res.status, 201);
  });
});
