import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp } from '../lib/testing.ts';
import { getStock, reserve } from './stock.ts';

const MESSAGE = 'quantity must be a positive whole number';

describe('reserve quantity validation', () => {
  for (const quantity of [0, -1, -5, 1.5, 0.5, NaN, Infinity, -Infinity]) {
    it(`rejects quantity ${quantity} with a 400 and leaves stock untouched`, () => {
      const app = createTestApp();
      const product = addProduct(app.ctx, { stock: 10 });
      reserve(app.ctx, [{ productId: product.id, quantity: 2 }]);
      assert.throws(
        () => reserve(app.ctx, [{ productId: product.id, quantity }]),
        (err: any) => err.status === 400 && err.message === MESSAGE,
      );
      const level = getStock(app.ctx, product.id);
      assert.equal(level.reserved, 2);
      assert.equal(level.onHand, 10);
    });
  }

  it('still reserves positive whole numbers', () => {
    const app = createTestApp();
    const product = addProduct(app.ctx, { stock: 10 });
    reserve(app.ctx, [{ productId: product.id, quantity: 1 }]);
    reserve(app.ctx, [{ productId: product.id, quantity: 3 }]);
    assert.equal(getStock(app.ctx, product.id).reserved, 4);
  });
});
