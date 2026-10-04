import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp, errorMessage, signUp } from '../lib/testing.ts';
import type { TestApp } from '../lib/testing.ts';
import type { Order } from '../types.ts';

interface ReorderBody {
  added: { productId: string; quantity: number }[];
  skipped: string[];
}

function cartLines(app: TestApp, token: string) {
  const body = app.call('GET', '/cart', { token }).body as { lines: { productId: string; quantity: number }[] };
  return body.lines.map((l) => ({ productId: l.productId, quantity: l.quantity }));
}

/** A customer who has checked out one order with a new product per entry of `quantities`. */
function orderWith(app: TestApp, quantities: number[], email = 'buyer@example.com') {
  const { token, user } = signUp(app.ctx, email);
  const products = quantities.map(() => addProduct(app.ctx));
  quantities.forEach((quantity, i) => {
    app.call('POST', '/cart/items', { token, body: { productId: products[i].id, quantity } });
  });
  const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
  assert.equal(res.status, 201);
  return { token, user, products, order: res.body as Order };
}

describe('POST /orders/:id/reorder', () => {
  it('puts the order lines into an empty cart', () => {
    const app = createTestApp();
    const { token, order, products } = orderWith(app, [2, 3]);
    assert.deepEqual(cartLines(app, token), []);
    const res = app.call('POST', `/orders/${order.id}/reorder`, { token });
    assert.equal(res.status, 200);
    const expected = [
      { productId: products[0].id, quantity: 2 },
      { productId: products[1].id, quantity: 3 },
    ];
    const body = res.body as ReorderBody;
    assert.deepEqual(body.skipped, []);
    const byId = (a: { productId: string }, b: { productId: string }) => a.productId.localeCompare(b.productId);
    assert.deepEqual([...body.added].sort(byId), [...expected].sort(byId));
    assert.deepEqual(cartLines(app, token).sort(byId), [...expected].sort(byId));
  });

  it('adds to quantities already in the cart', () => {
    const app = createTestApp();
    const { token, products } = orderWith(app, [2]);
    const order = app.call('GET', '/orders', { token }).body as { items?: Order[] } | Order[];
    const orderId = (Array.isArray(order) ? order : order.items!)[0].id;
    const productId = products[0].id;
    app.call('POST', '/cart/items', { token, body: { productId, quantity: 5 } });
    const other = addProduct(app.ctx);
    app.call('POST', '/cart/items', { token, body: { productId: other.id, quantity: 1 } });
    const res = app.call('POST', `/orders/${orderId}/reorder`, { token });
    assert.equal(res.status, 200);
    assert.deepEqual((res.body as ReorderBody).added, [{ productId, quantity: 2 }]);
    const inCart = new Map(cartLines(app, token).map((l) => [l.productId, l.quantity]));
    assert.equal(inCart.get(productId), 7);
    assert.equal(inCart.get(other.id), 1);
  });

  it('skips products that are no longer sold instead of failing', () => {
    const app = createTestApp();
    const { token, order, products } = orderWith(app, [1, 4]);
    app.ctx.store.products.update(products[0].id, { active: false });
    const res = app.call('POST', `/orders/${order.id}/reorder`, { token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      added: [{ productId: products[1].id, quantity: 4 }],
      skipped: [products[0].id],
    });
    assert.deepEqual(cartLines(app, token), [{ productId: products[1].id, quantity: 4 }]);
  });

  it('succeeds with nothing added when no product is sold any more', () => {
    const app = createTestApp();
    const { token, order, products } = orderWith(app, [2]);
    app.ctx.store.products.update(products[0].id, { active: false });
    const res = app.call('POST', `/orders/${order.id}/reorder`, { token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { added: [], skipped: [products[0].id] });
    assert.deepEqual(cartLines(app, token), []);
  });

  it("is a 404 for someone else's order and leaves the cart alone", () => {
    const app = createTestApp();
    const { order } = orderWith(app, [1], 'owner@example.com');
    const other = signUp(app.ctx, 'other@example.com');
    const res = app.call('POST', `/orders/${order.id}/reorder`, { token: other.token });
    assert.equal(res.status, 404);
    assert.ok(errorMessage(res).length > 0);
    assert.deepEqual(cartLines(app, other.token), []);
  });

  it("is a 404 for an admin reordering another customer's order", () => {
    const app = createTestApp();
    const { order } = orderWith(app, [1], 'owner@example.com');
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    const res = app.call('POST', `/orders/${order.id}/reorder`, { token: admin.token });
    assert.equal(res.status, 404);
    assert.deepEqual(cartLines(app, admin.token), []);
  });

  it('is a 404 for an unknown order', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx);
    const res = app.call('POST', '/orders/does-not-exist/reorder', { token });
    assert.equal(res.status, 404);
  });
});
