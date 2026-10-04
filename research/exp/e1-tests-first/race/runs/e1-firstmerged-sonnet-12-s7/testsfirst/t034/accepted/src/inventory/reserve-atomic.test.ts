import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp, errorMessage, signUp } from '../lib/testing.ts';
import { getStock, reserve } from './stock.ts';

describe('reserve is all or nothing', () => {
  it('reserves nothing when the last line is short', () => {
    const app = createTestApp();
    const a = addProduct(app.ctx, { stock: 10 });
    const b = addProduct(app.ctx, { stock: 10 });
    const c = addProduct(app.ctx, { stock: 0 });
    assert.throws(
      () =>
        reserve(app.ctx, [
          { productId: a.id, quantity: 2 },
          { productId: b.id, quantity: 3 },
          { productId: c.id, quantity: 1 },
        ]),
      (err: any) => err.status === 409 && err.message === `not enough stock for ${c.id}`,
    );
    assert.equal(getStock(app.ctx, a.id).reserved, 0);
    assert.equal(getStock(app.ctx, b.id).reserved, 0);
    assert.equal(getStock(app.ctx, c.id).reserved, 0);
  });

  it('names the first short line when several are short', () => {
    const app = createTestApp();
    const a = addProduct(app.ctx, { stock: 10 });
    const b = addProduct(app.ctx, { stock: 1 });
    const c = addProduct(app.ctx, { stock: 1 });
    assert.throws(
      () =>
        reserve(app.ctx, [
          { productId: a.id, quantity: 1 },
          { productId: b.id, quantity: 5 },
          { productId: c.id, quantity: 5 },
        ]),
      (err: any) => err.status === 409 && err.message === `not enough stock for ${b.id}`,
    );
    assert.equal(getStock(app.ctx, a.id).reserved, 0);
    assert.equal(getStock(app.ctx, b.id).reserved, 0);
    assert.equal(getStock(app.ctx, c.id).reserved, 0);
  });

  it('keeps earlier reservations intact when a later group fails', () => {
    const app = createTestApp();
    const a = addProduct(app.ctx, { stock: 10 });
    const b = addProduct(app.ctx, { stock: 1 });
    reserve(app.ctx, [{ productId: a.id, quantity: 4 }]);
    assert.throws(
      () =>
        reserve(app.ctx, [
          { productId: a.id, quantity: 2 },
          { productId: b.id, quantity: 2 },
        ]),
      (err: any) => err.status === 409,
    );
    assert.equal(getStock(app.ctx, a.id).reserved, 4);
    assert.equal(getStock(app.ctx, b.id).reserved, 0);
  });

  it('counts repeated lines of one product together', () => {
    const app = createTestApp();
    const a = addProduct(app.ctx, { stock: 5 });
    const b = addProduct(app.ctx, { stock: 5 });
    assert.throws(
      () =>
        reserve(app.ctx, [
          { productId: b.id, quantity: 1 },
          { productId: a.id, quantity: 3 },
          { productId: a.id, quantity: 3 },
        ]),
      (err: any) => err.status === 409 && err.message === `not enough stock for ${a.id}`,
    );
    assert.equal(getStock(app.ctx, a.id).reserved, 0);
    assert.equal(getStock(app.ctx, b.id).reserved, 0);
  });

  it('still reserves every line when all are covered', () => {
    const app = createTestApp();
    const a = addProduct(app.ctx, { stock: 5 });
    const b = addProduct(app.ctx, { stock: 5 });
    reserve(app.ctx, [
      { productId: a.id, quantity: 5 },
      { productId: b.id, quantity: 2 },
    ]);
    assert.equal(getStock(app.ctx, a.id).reserved, 5);
    assert.equal(getStock(app.ctx, b.id).reserved, 2);
  });

  it('does not leak stock when checkout fails with a 409', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx);
    const a = addProduct(app.ctx, { stock: 10 });
    const b = addProduct(app.ctx, { stock: 10 });
    const c = addProduct(app.ctx, { stock: 1 });
    for (const [p, quantity] of [[a, 2], [b, 3], [c, 1]] as const) {
      const res = app.call('POST', '/cart/items', { token, body: { productId: p.id, quantity } });
      assert.ok(res.status < 300, `cart add failed: ${JSON.stringify(res.body)}`);
    }
    // someone else takes the last unit of c after it was added to the cart
    reserve(app.ctx, [{ productId: c.id, quantity: 1 }]);
    for (let i = 0; i < 3; i++) {
      const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
      assert.equal(res.status, 409);
      assert.equal(errorMessage(res), `not enough stock for ${c.id}`);
    }
    assert.equal(getStock(app.ctx, a.id).reserved, 0);
    assert.equal(getStock(app.ctx, b.id).reserved, 0);
    assert.equal(getStock(app.ctx, c.id).reserved, 1);
  });
});
