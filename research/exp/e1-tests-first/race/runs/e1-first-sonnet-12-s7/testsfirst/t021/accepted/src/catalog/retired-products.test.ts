import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp, signUp } from '../lib/testing.ts';
import { getProduct, listProducts } from './service.ts';
import type { Product } from '../types.ts';

describe('retired products', () => {
  it('serves an active product by id', () => {
    const app = createTestApp();
    const product = addProduct(app.ctx);
    const res = app.call('GET', `/products/${product.id}`);
    assert.equal(res.status, 200);
    assert.equal((res.body as Product).id, product.id);
  });

  it('answers 404 for a retired product', () => {
    const app = createTestApp();
    const product = addProduct(app.ctx);
    app.ctx.store.products.update(product.id, { active: false });
    assert.equal(app.call('GET', `/products/${product.id}`).status, 404);
  });

  it('answers 404 after an admin retires the product through the API', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx, 'admin@example.com', { admin: true });
    const product = addProduct(app.ctx);
    assert.equal(app.call('PATCH', `/products/${product.id}`, { token, body: { active: false } }).status, 200);
    assert.equal(app.call('GET', `/products/${product.id}`).status, 404);
  });

  it('serves the product again once reactivated', () => {
    const app = createTestApp();
    const product = addProduct(app.ctx);
    app.ctx.store.products.update(product.id, { active: false });
    app.ctx.store.products.update(product.id, { active: true });
    assert.equal(app.call('GET', `/products/${product.id}`).status, 200);
  });

  it('still answers 404 for unknown ids', () => {
    const app = createTestApp();
    assert.equal(app.call('GET', '/products/prd_missing').status, 404);
  });

  it('still returns retired products from the service layer', () => {
    const app = createTestApp();
    const product = addProduct(app.ctx);
    app.ctx.store.products.update(product.id, { active: false });
    assert.equal(getProduct(app.ctx, product.id).id, product.id);
    assert.equal(getProduct(app.ctx, product.id).active, false);
  });

  it('keeps the list behaviour unchanged', () => {
    const app = createTestApp();
    const kept = addProduct(app.ctx, { name: 'Kept' });
    const retired = addProduct(app.ctx, { name: 'Retired' });
    app.ctx.store.products.update(retired.id, { active: false });
    const ids = (app.call('GET', '/products').body as Product[]).map((p) => p.id);
    assert.deepEqual(ids, [kept.id]);
    assert.equal(listProducts(app.ctx, { includeInactive: true }).length, 2);
  });
});
