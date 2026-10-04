import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, CA_ADDRESS, createTestApp, placeOrder, signUp, US_ADDRESS } from '../lib/testing.ts';
import type { Order, ShippingQuote } from '../types.ts';
import { quoteShipping, zoneFor } from './rates.ts';
import { markShipped } from './service.ts';

describe('shipping rates', () => {
  it('classifies destinations relative to the home country', () => {
    assert.equal(zoneFor(US_ADDRESS, 'US'), 'domestic');
    assert.equal(zoneFor(CA_ADDRESS, 'US'), 'neighbour');
    assert.equal(zoneFor({ ...CA_ADDRESS, country: 'jp' }, 'US'), 'international');
  });

  it('adds a charge for every started kilogram after the first', () => {
    assert.equal(quoteShipping(US_ADDRESS, 1, 'standard', 'US').cost, 500);
    assert.equal(quoteShipping(US_ADDRESS, 2.5, 'standard', 'US').cost, 800);
  });

  it('doubles the price and halves the delivery time for express', () => {
    const standard = quoteShipping(US_ADDRESS, 1, 'standard', 'US');
    const express = quoteShipping(US_ADDRESS, 1, 'express', 'US');
    assert.deepEqual([express.cost, express.etaDays], [standard.cost * 2, standard.etaDays / 2]);
  });

  it('quotes the current cart to a saved address', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx, 'a@example.com', { address: US_ADDRESS });
    const product = addProduct(app.ctx, { weightKg: 2 });
    app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 2 } });
    const res = app.call('POST', '/shipping/quote', { token, body: { addressIndex: 0, method: 'express' } });
    assert.equal((res.body as ShippingQuote).cost, (500 + 3 * 150) * 2);
  });
});

describe('shipping orders', () => {
  it('ships a confirmed order, records the shipment and emails the customer', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app);
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    const res = app.call('POST', `/orders/${order.id}/ship`, { token: admin.token, body: { trackingNumber: 'TRK-77' } });
    assert.equal((res.body as Order).status, 'shipped');
    const shipment = app.call('GET', `/orders/${order.id}/shipment`, { token }).body as { status: string; trackingNumber: string };
    assert.deepEqual([shipment.status, shipment.trackingNumber], ['shipped', 'TRK-77']);
    assert.match(app.mailer.sent.at(-1)!.subject, /has shipped/);
  });

  it('only ships confirmed orders and needs a tracking number', () => {
    const app = createTestApp();
    const { order } = placeOrder(app);
    assert.throws(() => markShipped(app.ctx, order.id, ''), /tracking number is required/);
    markShipped(app.ctx, order.id, 'TRK-1');
    assert.throws(() => markShipped(app.ctx, order.id, 'TRK-2'), /not confirmed/);
  });

});
