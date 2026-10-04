import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp, signUp } from '../lib/testing.ts';
import type { StockLevel } from '../types.ts';
import { availableQuantity, getStock, release, reserve, setStock } from './stock.ts';

describe('inventory', () => {
  it('reports zero stock for unknown products and validates updates', () => {
    const app = createTestApp();
    assert.deepEqual(getStock(app.ctx, 'prd_x'), { id: 'prd_x', onHand: 0, reserved: 0 });
    assert.throws(() => setStock(app.ctx, 'prd_x', -1), /non-negative/);
    assert.equal(setStock(app.ctx, 'prd_x', 4).onHand, 4);
    assert.equal(setStock(app.ctx, 'prd_x', 9).onHand, 9);
  });

  it('reserves and releases stock', () => {
    const app = createTestApp();
    const product = addProduct(app.ctx, { stock: 10 });
    reserve(app.ctx, [{ productId: product.id, quantity: 4 }]);
    assert.equal(availableQuantity(getStock(app.ctx, product.id)), 6);
    release(app.ctx, [{ productId: product.id, quantity: 10 }]);
    assert.equal(getStock(app.ctx, product.id).reserved, 0);
  });

  it('refuses to oversell with a 409', () => {
    const app = createTestApp();
    const product = addProduct(app.ctx, { stock: 2 });
    assert.throws(() => reserve(app.ctx, [{ productId: product.id, quantity: 3 }]), /not enough stock/);
    assert.equal(getStock(app.ctx, product.id).reserved, 0);
  });

  it('lists low stock to admins, scarcest first', () => {
    const app = createTestApp();
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    const customer = signUp(app.ctx, 'buyer@example.com');
    addProduct(app.ctx, { stock: 100 });
    const few = addProduct(app.ctx, { stock: 4 });
    const none = addProduct(app.ctx, { stock: 0 });
    assert.equal(app.call('GET', '/inventory/low-stock', { token: customer.token }).status, 403);
    const res = app.call('GET', '/inventory/low-stock', { token: admin.token });
    assert.deepEqual((res.body as StockLevel[]).map((s) => s.id), [none.id, few.id]);
  });

});
