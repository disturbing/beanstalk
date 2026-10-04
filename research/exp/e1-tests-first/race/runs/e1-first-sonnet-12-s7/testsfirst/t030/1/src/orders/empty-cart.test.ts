import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CA_ADDRESS, createTestApp, errorMessage, signUp } from '../lib/testing.ts';

describe('checkout with an empty cart', () => {
  it('rejects with 400 "cart is empty"', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx, 'empty@example.com', { address: CA_ADDRESS });
    const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
    assert.equal(res.status, 400);
    assert.equal(errorMessage(res), 'cart is empty');
  });

  it('creates no invoice and no order', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx, 'empty@example.com', { address: CA_ADDRESS });
    app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
    assert.equal(app.ctx.store.invoices.find(() => true).length, 0);
    assert.equal(app.ctx.store.orders.find(() => true).length, 0);
  });

  it('rejects the empty cart before looking at the coupon', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx, 'empty@example.com', { address: CA_ADDRESS });
    const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0, couponCode: 'NOPE' } });
    assert.equal(res.status, 400);
    assert.equal(errorMessage(res), 'cart is empty');
  });
});
