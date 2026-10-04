import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addCoupon, addProduct, CA_ADDRESS, createTestApp, placeOrder, signUp } from '../lib/testing.ts';
import type { ShippingQuote } from '../types.ts';
import { quoteShipping } from './rates.ts';
import * as shippingService from './service.ts';

function threshold(): number {
  return (shippingService as unknown as { FREE_SHIPPING_THRESHOLD: number }).FREE_SHIPPING_THRESHOLD;
}

/** Quote a cart of `items` (price in cents, quantity) to a saved address. */
function quoteCart(items: Array<{ price: number; quantity: number }>, method?: 'standard' | 'express') {
  const app = createTestApp();
  const { token } = signUp(app.ctx, 'q@example.com', { address: CA_ADDRESS });
  for (const item of items) {
    const product = addProduct(app.ctx, { price: item.price, weightKg: 1 });
    app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: item.quantity } });
  }
  const res = app.call('POST', '/shipping/quote', { token, body: { addressIndex: 0, method } });
  assert.equal(res.status, 200);
  return { app, quote: res.body as ShippingQuote };
}

describe('free standard shipping threshold', () => {
  it('exports the threshold as $75.00 in cents', () => {
    assert.equal(threshold(), 7500);
  });

  it('quotes free standard shipping when goods total exactly the threshold', () => {
    const { quote } = quoteCart([{ price: 2500, quantity: 3 }]);
    assert.equal(quote.cost, 0);
    assert.equal(quote.method, 'standard');
  });

  it('charges standard shipping one cent below the threshold', () => {
    const { app, quote } = quoteCart([{ price: 7499, quantity: 1 }]);
    assert.equal(quote.cost, quoteShipping(CA_ADDRESS, 1, 'standard', app.ctx.config.defaultCountry).cost);
    assert.ok(quote.cost > 0);
  });

  it('uses price times quantity summed over all lines', () => {
    assert.equal(quoteCart([{ price: 3000, quantity: 1 }, { price: 2500, quantity: 2 }]).quote.cost, 0);
    assert.ok(quoteCart([{ price: 3000, quantity: 1 }, { price: 2000, quantity: 2 }]).quote.cost > 0);
  });

  it('defaults to standard when no method is given', () => {
    assert.equal(quoteCart([{ price: 10000, quantity: 1 }]).quote.cost, 0);
  });

  it('never makes express shipping free', () => {
    const { app, quote } = quoteCart([{ price: 10000, quantity: 1 }], 'express');
    const expected = quoteShipping(CA_ADDRESS, 1, 'express', app.ctx.config.defaultCountry).cost;
    assert.ok(expected > 0);
    assert.equal(quote.cost, expected);
  });

  it('does not change the delivery estimate', () => {
    const { app, quote } = quoteCart([{ price: 10000, quantity: 1 }]);
    assert.equal(quote.etaDays, quoteShipping(CA_ADDRESS, 1, 'standard', app.ctx.config.defaultCountry).etaDays);
  });

  it('charges no standard shipping on an order at the threshold', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { price: 2500, quantity: 3 });
    assert.equal(order.shippingCost, 0);
  });

  it('still charges standard shipping on an order below the threshold', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { price: 7499, quantity: 1 });
    assert.ok(order.shippingCost > 0);
  });

  it('measures the threshold before discounts', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'HALF', value: 50 });
    const { order } = placeOrder(app, { price: 10000, quantity: 1, couponCode: 'HALF' });
    assert.equal(order.shippingCost, 0);
  });

  it('measures the threshold before tax, not after', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { price: 7000, quantity: 1 });
    assert.ok(order.shippingCost > 0);
  });

  it('keeps express shipping charged on an order over the threshold', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx, 'x@example.com', { address: CA_ADDRESS });
    const product = addProduct(app.ctx, { price: 10000, weightKg: 1 });
    app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 1 } });
    const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0, method: 'express' } });
    assert.equal(res.status, 201);
    assert.ok((res.body as { shippingCost: number }).shippingCost > 0);
  });
});
