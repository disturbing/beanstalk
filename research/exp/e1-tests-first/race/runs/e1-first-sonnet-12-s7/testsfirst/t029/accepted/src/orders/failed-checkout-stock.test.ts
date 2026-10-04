import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getStock } from '../inventory/stock.ts';
import { addCoupon, addProduct, createTestApp, signUp, tryCheckout } from '../lib/testing.ts';

describe('failed checkout leaves stock and cart untouched', () => {
  function assertUntouched(app: ReturnType<typeof createTestApp>, co: ReturnType<typeof tryCheckout>, quantity: number) {
    assert.ok(co.res.status >= 400, `expected failure, got ${co.res.status}`);
    const level = getStock(app.ctx, co.product.id);
    assert.equal(level.reserved, 0);
    assert.equal(level.onHand, 100);
    const cart = app.ctx.store.carts.get(co.user.id);
    assert.deepEqual(
      cart?.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
      [{ productId: co.product.id, quantity }],
    );
    assert.equal(app.ctx.store.orders.find(() => true).length, 0);
  }

  it('releases stock when the coupon code is unknown', () => {
    const app = createTestApp();
    const co = tryCheckout(app, { couponCode: 'NOPE', quantity: 3 });
    assertUntouched(app, co, 3);
  });

  it('releases stock when the cart is below the coupon minimum', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'BIG', minSubtotal: 100000 });
    const co = tryCheckout(app, { couponCode: 'BIG', quantity: 2 });
    assertUntouched(app, co, 2);
  });

  it('does not accumulate reservations over repeated failures', () => {
    const app = createTestApp();
    const { user, token } = signUp(app.ctx, 'repeat@example.com');
    const product = addProduct(app.ctx, { stock: 5 });
    app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 4 } });
    for (let i = 0; i < 3; i++) {
      const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0, couponCode: 'NOPE' } });
      assert.ok(res.status >= 400);
    }
    assert.equal(getStock(app.ctx, product.id).reserved, 0);
    const ok = app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
    assert.equal(ok.status, 201);
    assert.equal(app.ctx.store.carts.get(user.id)?.lines.length ?? 0, 0);
  });

  it('releases earlier lines when a later line lacks stock', () => {
    const app = createTestApp();
    const { user, token } = signUp(app.ctx, 'multi@example.com');
    const a = addProduct(app.ctx, { stock: 10 });
    const b = addProduct(app.ctx, { stock: 1 });
    app.call('POST', '/cart/items', { token, body: { productId: a.id, quantity: 2 } });
    app.call('POST', '/cart/items', { token, body: { productId: b.id, quantity: 5 } });
    const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
    assert.equal(res.status, 409);
    assert.equal(getStock(app.ctx, a.id).reserved, 0);
    assert.equal(getStock(app.ctx, b.id).reserved, 0);
    assert.equal(app.ctx.store.carts.get(user.id)?.lines.length, 2);
  });
});
