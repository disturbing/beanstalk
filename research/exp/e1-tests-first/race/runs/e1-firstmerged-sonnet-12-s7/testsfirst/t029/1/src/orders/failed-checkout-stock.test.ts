import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getCart } from '../cart/service.ts';
import { getStock } from '../inventory/stock.ts';
import { addProduct, createTestApp, signUp, tryCheckout } from '../lib/testing.ts';
import type { TestApp } from '../lib/testing.ts';

function assertUntouched(app: TestApp, productId: string, userId: string, onHand: number, quantity: number) {
  assert.deepEqual(getStock(app.ctx, productId), { id: productId, onHand, reserved: 0 });
  const lines = getCart(app.ctx, userId).lines;
  assert.equal(lines.length, 1);
  assert.equal(lines[0].productId, productId);
  assert.equal(lines[0].quantity, quantity);
}

describe('failed checkout leaves stock and cart as they were', () => {
  it('releases stock when the coupon code is unknown', () => {
    const app = createTestApp();
    const { res, user, product } = tryCheckout(app, { couponCode: 'NOPE', quantity: 3, stock: 10 });
    assert.equal(res.status, 400);
    assertUntouched(app, product.id, user.id, 10, 3);
  });

  it('releases stock when the cart is below the coupon minimum', () => {
    const app = createTestApp();
    const { res, user, product } = tryCheckout(app, { couponCode: 'FIVEOFF', price: 500, quantity: 2, stock: 10 });
    assert.ok(res.status >= 400 && res.status < 500);
    assertUntouched(app, product.id, user.id, 10, 2);
  });

  it('does not accumulate reservations over repeated failed attempts', () => {
    const app = createTestApp();
    const { token, product, user } = tryCheckout(app, { couponCode: 'NOPE', quantity: 2, stock: 5 });
    for (let i = 0; i < 3; i++) {
      const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0, couponCode: 'NOPE' } });
      assert.equal(res.status, 400);
    }
    assertUntouched(app, product.id, user.id, 5, 2);
    // the customer can still buy the stock afterwards
    const ok = app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
    assert.equal(ok.status, 201);
    assert.equal(getStock(app.ctx, product.id).reserved, 2);
  });

  it('reserves nothing when a later line cannot be covered', () => {
    const app = createTestApp();
    const { user, token } = signUp(app.ctx, 'multi@example.com');
    const a = addProduct(app.ctx, { stock: 10 });
    const b = addProduct(app.ctx, { stock: 1 });
    app.call('POST', '/cart/items', { token, body: { productId: a.id, quantity: 4 } });
    app.call('POST', '/cart/items', { token, body: { productId: b.id, quantity: 2 } });
    const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
    assert.equal(res.status, 409);
    assert.equal(getStock(app.ctx, a.id).reserved, 0);
    assert.equal(getStock(app.ctx, b.id).reserved, 0);
    assert.equal(getCart(app.ctx, user.id).lines.length, 2);
  });

  it('does not count a coupon redemption or create an order on failure', () => {
    const app = createTestApp();
    const { user } = tryCheckout(app, { couponCode: 'FIVEOFF', price: 500, stock: 4 });
    assert.equal(app.ctx.store.coupons.require('FIVEOFF').redemptions, 0);
    assert.equal(app.ctx.store.orders.find((o) => o.userId === user.id).length, 0);
  });
});
