import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { paginate } from './pagination.ts';
import { addProduct, createTestApp, placeOrder, signUp } from './testing.ts';

const items = Array.from({ length: 150 }, (_, i) => i);

describe('paginate returns items and total', () => {
  it('returns the page and the unpaged count', () => {
    const result = paginate(items, { limit: '3', offset: '10' });
    assert.deepEqual(result, { items: [10, 11, 12], total: 150 });
  });

  it('reports the total for the default page and a clamped limit', () => {
    const first = paginate(items, {});
    assert.equal(first.items.length, 20);
    assert.equal(first.total, 150);
    const clamped = paginate(items, { limit: '1000' });
    assert.equal(clamped.items.length, 100);
    assert.equal(clamped.total, 150);
  });

  it('reports the total when the offset is past the end', () => {
    assert.deepEqual(paginate(items, { offset: '500' }), { items: [], total: 150 });
  });

  it('reports a total of zero for an empty list', () => {
    assert.deepEqual(paginate([], {}), { items: [], total: 0 });
  });
});

describe('x-total-count header', () => {
  it('is sent on GET /products with a plain array body', () => {
    const app = createTestApp();
    for (let i = 0; i < 5; i++) addProduct(app.ctx);
    const res = app.call('GET', '/products', { query: { limit: '2' } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.equal((res.body as unknown[]).length, 2);
    assert.equal(res.headers['x-total-count'], '5');
  });

  it('counts the filtered products, not the page', () => {
    const app = createTestApp();
    for (let i = 0; i < 3; i++) addProduct(app.ctx, { category: 'tea' });
    for (let i = 0; i < 4; i++) addProduct(app.ctx, { category: 'coffee' });
    const res = app.call('GET', '/products', { query: { category: 'tea', limit: '1', offset: '1' } });
    assert.equal((res.body as unknown[]).length, 1);
    assert.equal(res.headers['x-total-count'], '3');
  });

  it('is sent on GET /orders with a plain array body', () => {
    const app = createTestApp();
    const { token } = placeOrder(app, { email: 'multi@example.com' });
    for (let i = 0; i < 2; i++) {
      const product = addProduct(app.ctx);
      app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 1 } });
      const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
      assert.equal(res.status, 201);
    }
    // another user's orders must not be counted
    placeOrder(app, { email: 'other@example.com' });
    const res = app.call('GET', '/orders', { token, query: { limit: '2' } });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.equal((res.body as unknown[]).length, 2);
    assert.equal(res.headers['x-total-count'], '3');
  });

  it('is 0 for a user with no orders', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx, 'none@example.com');
    const res = app.call('GET', '/orders', { token });
    assert.deepEqual(res.body, []);
    assert.equal(res.headers['x-total-count'], '0');
  });
});
