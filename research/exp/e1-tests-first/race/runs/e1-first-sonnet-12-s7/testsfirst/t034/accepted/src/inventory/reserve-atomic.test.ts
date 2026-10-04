import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp, errorMessage, signUp } from '../lib/testing.ts';
import { getStock, reserve } from './stock.ts';

function conflictFrom(fn: () => void): { status: number; message: string } {
  try {
    fn();
  } catch (err) {
    return err as { status: number; message: string };
  }
  assert.fail('expected reserve to throw');
}

describe('reserve is all or nothing', () => {
  it('reserves nothing when the last line is short, and names that line', () => {
    const app = createTestApp();
    const a = addProduct(app.ctx, { stock: 10 });
    const b = addProduct(app.ctx, { stock: 10 });
    const c = addProduct(app.ctx, { stock: 1 });
    const err = conflictFrom(() =>
      reserve(app.ctx, [
        { productId: a.id, quantity: 2 },
        { productId: b.id, quantity: 3 },
        { productId: c.id, quantity: 5 },
      ]),
    );
    assert.equal(err.status, 409);
    assert.ok(err.message.includes(c.id), err.message);
    assert.equal(getStock(app.ctx, a.id).reserved, 0);
    assert.equal(getStock(app.ctx, b.id).reserved, 0);
    assert.equal(getStock(app.ctx, c.id).reserved, 0);
  });

  it('names the first short line when several are short', () => {
    const app = createTestApp();
    const a = addProduct(app.ctx, { stock: 10 });
    const b = addProduct(app.ctx, { stock: 1 });
    const c = addProduct(app.ctx, { stock: 0 });
    const err = conflictFrom(() =>
      reserve(app.ctx, [
        { productId: a.id, quantity: 1 },
        { productId: b.id, quantity: 2 },
        { productId: c.id, quantity: 1 },
      ]),
    );
    assert.equal(err.status, 409);
    assert.ok(err.message.includes(b.id), err.message);
    assert.ok(!err.message.includes(c.id), err.message);
    assert.equal(getStock(app.ctx, a.id).reserved, 0);
  });

  it('leaves earlier reservations untouched when a later group fails', () => {
    const app = createTestApp();
    const a = addProduct(app.ctx, { stock: 10 });
    const b = addProduct(app.ctx, { stock: 2 });
    reserve(app.ctx, [{ productId: a.id, quantity: 4 }]);
    assert.throws(() =>
      reserve(app.ctx, [
        { productId: a.id, quantity: 1 },
        { productId: b.id, quantity: 3 },
      ]),
    );
    assert.equal(getStock(app.ctx, a.id).reserved, 4);
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

  it('does not leak stock across repeated failed checkouts', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx);
    const a = addProduct(app.ctx, { stock: 10 });
    const b = addProduct(app.ctx, { stock: 10 });
    const c = addProduct(app.ctx, { stock: 1 });
    for (const [p, q] of [[a, 2], [b, 3], [c, 5]] as const) {
      app.call('POST', '/cart/items', { token, body: { productId: p.id, quantity: q } });
    }
    for (let i = 0; i < 3; i++) {
      const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
      assert.equal(res.status, 409);
      assert.ok(errorMessage(res).includes(c.id), errorMessage(res));
    }
    assert.equal(getStock(app.ctx, a.id).reserved, 0);
    assert.equal(getStock(app.ctx, b.id).reserved, 0);
  });
});
