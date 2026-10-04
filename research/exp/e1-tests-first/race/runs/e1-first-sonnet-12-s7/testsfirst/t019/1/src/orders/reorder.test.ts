import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp, signUp } from '../lib/testing.ts';
import type { TestApp } from '../lib/testing.ts';

interface ReorderBody {
  added: { productId: string; quantity: number }[];
  skipped: string[];
}

/** A customer who has checked out an order with two lines (quantities 2 and 3). The cart is empty afterwards. */
function orderWithTwoLines(app: TestApp) {
  const { token, user } = signUp(app.ctx, 'buyer@example.com');
  const first = addProduct(app.ctx);
  const second = addProduct(app.ctx);
  app.call('POST', '/cart/items', { token, body: { productId: first.id, quantity: 2 } });
  app.call('POST', '/cart/items', { token, body: { productId: second.id, quantity: 3 } });
  const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
  assert.equal(res.status, 201);
  return { token, user, first, second, order: res.body as { id: string } };
}

function cartLines(app: TestApp, token: string) {
  const cart = app.call('GET', '/cart', { token }).body as { lines: { productId: string; quantity: number }[] };
  return cart.lines.map((l) => ({ productId: l.productId, quantity: l.quantity }));
}

const byProduct = (a: { productId: string }, b: { productId: string }) => a.productId.localeCompare(b.productId);

describe('POST /orders/:id/reorder', () => {
  it('puts the order lines into the cart with the same quantities and reports them', () => {
    const app = createTestApp();
    const { token, first, second, order } = orderWithTwoLines(app);
    assert.deepEqual(cartLines(app, token), []);

    const res = app.call('POST', `/orders/${order.id}/reorder`, { token });
    assert.equal(res.status, 200);
    const body = res.body as ReorderBody;
    const want = [
      { productId: first.id, quantity: 2 },
      { productId: second.id, quantity: 3 },
    ].sort(byProduct);
    assert.deepEqual(body.added.slice().sort(byProduct), want);
    assert.deepEqual(body.skipped, []);
    assert.deepEqual(cartLines(app, token).sort(byProduct), want);
  });

  it('adds to what is already in the cart', () => {
    const app = createTestApp();
    const { token, first, second, order } = orderWithTwoLines(app);
    const other = addProduct(app.ctx);
    app.call('POST', '/cart/items', { token, body: { productId: first.id, quantity: 1 } });
    app.call('POST', '/cart/items', { token, body: { productId: other.id, quantity: 4 } });

    const res = app.call('POST', `/orders/${order.id}/reorder`, { token });
    assert.equal(res.status, 200);
    assert.deepEqual(
      cartLines(app, token).sort(byProduct),
      [
        { productId: first.id, quantity: 3 },
        { productId: second.id, quantity: 3 },
        { productId: other.id, quantity: 4 },
      ].sort(byProduct),
    );
  });

  it('skips products that are no longer sold instead of failing', () => {
    const app = createTestApp();
    const { token, first, second, order } = orderWithTwoLines(app);
    app.ctx.store.products.update(first.id, { active: false });

    const res = app.call('POST', `/orders/${order.id}/reorder`, { token });
    assert.equal(res.status, 200);
    const body = res.body as ReorderBody;
    assert.deepEqual(body.added, [{ productId: second.id, quantity: 3 }]);
    assert.deepEqual(body.skipped, [first.id]);
    assert.deepEqual(cartLines(app, token), [{ productId: second.id, quantity: 3 }]);
  });

  it('responds 200 with everything skipped when no product is sold any more', () => {
    const app = createTestApp();
    const { token, first, second, order } = orderWithTwoLines(app);
    app.ctx.store.products.update(first.id, { active: false });
    app.ctx.store.products.update(second.id, { active: false });

    const res = app.call('POST', `/orders/${order.id}/reorder`, { token });
    assert.equal(res.status, 200);
    const body = res.body as ReorderBody;
    assert.deepEqual(body.added, []);
    assert.deepEqual(body.skipped.slice().sort(), [first.id, second.id].sort());
    assert.deepEqual(cartLines(app, token), []);
  });

  it("is a 404 for someone else's order and leaves their cart alone", () => {
    const app = createTestApp();
    const { order } = orderWithTwoLines(app);
    const other = signUp(app.ctx, 'other@example.com');
    const res = app.call('POST', `/orders/${order.id}/reorder`, { token: other.token });
    assert.equal(res.status, 404);
    assert.deepEqual(cartLines(app, other.token), []);
  });

  it("is a 404 for an admin reordering someone else's order", () => {
    const app = createTestApp();
    const { order } = orderWithTwoLines(app);
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    const res = app.call('POST', `/orders/${order.id}/reorder`, { token: admin.token });
    assert.equal(res.status, 404);
    assert.deepEqual(cartLines(app, admin.token), []);
  });

  it('is a 404 for an unknown order', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx);
    assert.equal(app.call('POST', '/orders/no-such-order/reorder', { token }).status, 404);
  });
});
