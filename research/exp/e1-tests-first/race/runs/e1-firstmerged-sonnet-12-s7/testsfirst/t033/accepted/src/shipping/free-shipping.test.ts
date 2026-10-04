import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addCoupon, addProduct, createTestApp, placeOrder, signUp, US_ADDRESS } from '../lib/testing.ts';
import type { TestApp } from '../lib/testing.ts';
import type { ShippingQuote } from '../types.ts';
import { FREE_SHIPPING_THRESHOLD } from './service.ts';

let emailCounter = 0;

/** Quote a cart holding the given [price, quantity] lines. */
function quoteCart(app: TestApp, lines: Array<[number, number]>, method?: string): ShippingQuote {
  emailCounter += 1;
  const { token } = signUp(app.ctx, `q${emailCounter}@example.com`, { address: US_ADDRESS });
  for (const [price, quantity] of lines) {
    const product = addProduct(app.ctx, { price });
    app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity } });
  }
  const res = app.call('POST', '/shipping/quote', { token, body: { addressIndex: 0, method } });
  assert.equal(res.status, 200);
  return res.body as ShippingQuote;
}

describe('free standard shipping over the threshold', () => {
  it('sets the threshold at $75.00', () => {
    assert.equal(FREE_SHIPPING_THRESHOLD, 7500);
  });

  it('quotes standard shipping at 0 when goods are exactly the threshold', () => {
    const app = createTestApp();
    assert.equal(quoteCart(app, [[2500, 3]]).cost, 0);
  });

  it('quotes standard shipping at 0 above the threshold, with the default method', () => {
    const app = createTestApp();
    assert.equal(quoteCart(app, [[10000, 1]]).cost, 0);
    assert.equal(quoteCart(app, [[10000, 1]], 'standard').cost, 0);
  });

  it('charges shipping one cent below the threshold', () => {
    const app = createTestApp();
    assert.ok(quoteCart(app, [[7499, 1]]).cost > 0);
  });

  it('adds up price times quantity across lines', () => {
    const app = createTestApp();
    assert.equal(quoteCart(app, [[2000, 2], [3500, 1]]).cost, 0);
    assert.ok(quoteCart(app, [[2000, 2], [3499, 1]]).cost > 0);
  });

  it('does not change delivery time estimates', () => {
    const app = createTestApp();
    const paid = quoteCart(app, [[1000, 1]]);
    const free = quoteCart(app, [[10000, 1]]);
    assert.equal(free.method, 'standard');
    assert.equal(free.etaDays, paid.etaDays);
  });

  it('never makes express shipping free', () => {
    const app = createTestApp();
    const express = quoteCart(app, [[10000, 1]], 'express');
    const standardPaid = quoteCart(app, [[1000, 1]], 'standard');
    assert.equal(express.method, 'express');
    assert.equal(express.cost, standardPaid.cost * 2);
    assert.equal(express.etaDays, Math.ceil(standardPaid.etaDays / 2));
  });

  it('charges no shipping on a standard order at or over the threshold', () => {
    const app = createTestApp();
    assert.equal(placeOrder(app, { price: 2500, quantity: 3 }).order.shippingCost, 0);
    assert.equal(placeOrder(app, { email: 'b@example.com', price: 20000 }).order.shippingCost, 0);
  });

  it('charges shipping on a standard order below the threshold', () => {
    const app = createTestApp();
    assert.ok(placeOrder(app, { price: 7499 }).order.shippingCost > 0);
  });

  it('still charges for express on an order over the threshold', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx, 'x@example.com', { address: US_ADDRESS });
    const product = addProduct(app.ctx, { price: 10000 });
    app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 1 } });
    const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0, method: 'express' } });
    assert.equal(res.status, 201);
    assert.ok((res.body as { shippingCost: number }).shippingCost > 0);
  });

  it('judges the threshold before discounts', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'HALF', kind: 'percent', value: 50 });
    const { order } = placeOrder(app, { price: 8000, couponCode: 'HALF' });
    assert.equal(order.shippingCost, 0);
  });

  it('judges the threshold before tax', () => {
    const app = createTestApp();
    // $70.00 of goods may pass $75 once tax is added, but must still pay shipping.
    assert.ok(placeOrder(app, { price: 7000 }).order.shippingCost > 0);
  });
});
