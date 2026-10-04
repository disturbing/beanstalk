import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { paginate } from './pagination.ts';
import { addProduct, createTestApp, placeOrder, signUp } from './testing.ts';

const items = Array.from({ length: 150 }, (_, i) => i);

describe('paginate total', () => {
  it('returns the page and the pre-paging total', () => {
    const result = paginate(items, { limit: '3', offset: '10' });
    assert.deepEqual(result.items, [10, 11, 12]);
    assert.equal(result.total, 150);
  });

  it('reports the full total with default paging', () => {
    const result = paginate(items, {});
    assert.equal(result.items.length, 20);
    assert.equal(result.total, 150);
  });

  it('reports the total when the limit is clamped', () => {
    const result = paginate(items, { limit: '1000' });
    assert.equal(result.items.length, 100);
    assert.equal(result.total, 150);
  });

  it('reports the total when the offset is past the end', () => {
    const result = paginate(items, { offset: '500' });
    assert.deepEqual(result.items, []);
    assert.equal(result.total, 150);
  });

  it('reports zero for an empty list', () => {
    const result = paginate([], {});
    assert.deepEqual(result.items, []);
    assert.equal(result.total, 0);
  });
});

describe('x-total-count header', () => {
  it('is sent on GET /products with a plain array body', () => {
    const app = createTestApp();
    for (let i = 0; i < 25; i++) addProduct(app.ctx);
    const res = app.call('GET', '/products', { query: { limit: '5' } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.equal((res.body as unknown[]).length, 5);
    assert.equal(res.headers['x-total-count'], '25');
  });

  it('counts products matching the filter, not just the page', () => {
    const app = createTestApp();
    for (let i = 0; i < 4; i++) addProduct(app.ctx, { category: 'tea' });
    for (let i = 0; i < 3; i++) addProduct(app.ctx, { category: 'coffee' });
    const res = app.call('GET', '/products', { query: { category: 'tea', limit: '2' } });
    assert.equal((res.body as unknown[]).length, 2);
    assert.equal(res.headers['x-total-count'], '4');
  });

  it('is sent on GET /orders with a plain array body', () => {
    const app = createTestApp();
    const { token } = placeOrder(app);
    for (let i = 0; i < 2; i++) {
      app.call('POST', '/cart/items', { token, body: { productId: addProduct(app.ctx).id, quantity: 1 } });
      assert.equal(app.call('POST', '/checkout', { token, body: { addressIndex: 0 } }).status, 201);
    }
    const res = app.call('GET', '/orders', { token, query: { limit: '2' } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.equal((res.body as unknown[]).length, 2);
    assert.equal(res.headers['x-total-count'], '3');
  });

  it('is 0 for a user with no orders', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx);
    const res = app.call('GET', '/orders', { token });
    assert.deepEqual(res.body, []);
    assert.equal(res.headers['x-total-count'], '0');
  });
});
