import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp, signUp } from '../lib/testing.ts';
import type { Product } from '../types.ts';

const newProduct = { sku: 'MUG-1', name: 'Enamel Mug', price: 1250, category: 'kitchen' };

describe('catalog', () => {
  it('lets admins create products and keeps customers out', () => {
    const app = createTestApp();
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    const customer = signUp(app.ctx, 'buyer@example.com');
    assert.equal(app.call('POST', '/products', { token: customer.token, body: newProduct }).status, 403);
    const res = app.call('POST', '/products', { token: admin.token, body: newProduct });
    assert.equal(res.status, 201);
    assert.equal((res.body as Product).taxClass, 'standard');
  });

  it('rejects duplicate SKUs and negative prices', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx, 'admin@example.com', { admin: true });
    app.call('POST', '/products', { token, body: newProduct });
    assert.equal(app.call('POST', '/products', { token, body: newProduct }).status, 409);
    assert.equal(app.call('POST', '/products', { token, body: { ...newProduct, sku: 'X', price: -1 } }).status, 400);
  });

  it('lists active products sorted by name', () => {
    const app = createTestApp();
    addProduct(app.ctx, { name: 'Zebra print' });
    addProduct(app.ctx, { name: 'Apple press' });
    const hidden = addProduct(app.ctx, { name: 'Hidden' });
    app.ctx.store.products.update(hidden.id, { active: false });
    const names = (app.call('GET', '/products').body as Product[]).map((p) => p.name);
    assert.deepEqual(names, ['Apple press', 'Zebra print']);
  });

  it('filters by category and by search words', () => {
    const app = createTestApp();
    addProduct(app.ctx, { name: 'Dark roast beans', category: 'coffee' });
    addProduct(app.ctx, { name: 'Blue mug', category: 'kitchen', description: 'Holds dark roast well' });
    const list = (query: Record<string, string>) => (app.call('GET', '/products', { query }).body as Product[]).length;
    assert.equal(list({ category: 'coffee' }), 1);
    assert.equal(list({ q: 'DARK roast' }), 2);
    assert.equal(list({ q: 'dark mug' }), 1);
  });

  it('updates a price and 404s on unknown products', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx, 'admin@example.com', { admin: true });
    const product = addProduct(app.ctx);
    const res = app.call('PATCH', `/products/${product.id}`, { token, body: { price: 999 } });
    assert.equal((res.body as Product).price, 999);
    assert.equal(app.call('GET', '/products/prd_9999').status, 404);
  });

});
