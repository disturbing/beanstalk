import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp } from '../lib/testing.ts';
import { getStock, reserve } from './stock.ts';

const MESSAGE = 'quantity must be a positive whole number';

describe('reserve quantity validation', () => {
  for (const quantity of [0, -1, -5, 1.5, 0.5, NaN, Infinity, -Infinity]) {
    it(`rejects quantity ${quantity} with a 400 and leaves the counters alone`, () => {
      const app = createTestApp();
      const product = addProduct(app.ctx, { stock: 10 });
      reserve(app.ctx, [{ productId: product.id, quantity: 3 }]);
      assert.throws(
        () => reserve(app.ctx, [{ productId: product.id, quantity }]),
        (err: unknown) => {
          const e = err as { status: number; message: string };
          assert.equal(e.status, 400);
          assert.equal(e.message, MESSAGE);
          return true;
        },
      );
      assert.deepEqual(getStock(app.ctx, product.id), { id: product.id, onHand: 10, reserved: 3 });
    });
  }

  it('still reserves positive whole numbers', () => {
    const app = createTestApp();
    const product = addProduct(app.ctx, { stock: 10 });
    reserve(app.ctx, [{ productId: product.id, quantity: 1 }]);
    reserve(app.ctx, [{ productId: product.id, quantity: 4 }]);
    assert.equal(getStock(app.ctx, product.id).reserved, 5);
  });
});
