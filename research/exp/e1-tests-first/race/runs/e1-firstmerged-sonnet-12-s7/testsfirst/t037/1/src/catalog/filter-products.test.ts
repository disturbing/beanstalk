import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp } from '../lib/testing.ts';
import * as service from './service.ts';
import type { Product } from '../types.ts';

function product(overrides: Partial<Product> & { id: string }): Product {
  return {
    sku: `SKU-${overrides.id}`,
    name: `Name ${overrides.id}`,
    description: '',
    price: 1000,
    category: 'general',
    taxClass: 'standard',
    weightKg: 0.5,
    active: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function filterProducts(products: Product[], filter: service.ProductFilter): Product[] {
  const fn = (service as Record<string, unknown>).filterProducts;
  assert.equal(typeof fn, 'function', 'filterProducts must be exported from catalog/service.ts');
  return (fn as typeof filterProducts)(products, filter);
}

const ids = (list: Product[]) => list.map((p) => p.id);

describe('filterProducts', () => {
  const coffee = product({ id: 'a', name: 'Dark roast beans', category: 'coffee' });
  const mug = product({ id: 'b', name: 'Blue mug', category: 'kitchen', description: 'Holds dark roast well' });
  const retired = product({ id: 'c', name: 'Old kettle', category: 'kitchen', active: false });
  const all = [coffee, mug, retired];

  it('drops inactive products unless includeInactive is set', () => {
    assert.deepEqual(ids(filterProducts(all, {})), ['a', 'b']);
    assert.deepEqual(ids(filterProducts(all, { includeInactive: false })), ['a', 'b']);
    assert.deepEqual(ids(filterProducts(all, { includeInactive: true })), ['a', 'b', 'c']);
  });

  it('filters by exact category', () => {
    assert.deepEqual(ids(filterProducts(all, { category: 'kitchen' })), ['b']);
    assert.deepEqual(ids(filterProducts(all, { category: 'kitchen', includeInactive: true })), ['b', 'c']);
    assert.deepEqual(ids(filterProducts(all, { category: 'Kitchen' })), []);
  });

  it('filters by search words across name, description and sku', () => {
    assert.deepEqual(ids(filterProducts(all, { q: 'dark roast' })), ['a', 'b']);
    assert.deepEqual(ids(filterProducts(all, { q: 'dark mug' })), ['b']);
    assert.deepEqual(ids(filterProducts(all, { q: 'SKU-A' })), ['a']);
    assert.deepEqual(ids(filterProducts(all, { q: 'kettle' })), []);
    assert.deepEqual(ids(filterProducts(all, { q: 'kettle', includeInactive: true })), ['c']);
  });

  it('combines category, q and includeInactive', () => {
    assert.deepEqual(ids(filterProducts(all, { category: 'kitchen', q: 'dark' })), ['b']);
    assert.deepEqual(ids(filterProducts(all, { category: 'coffee', q: 'mug' })), []);
  });

  it('keeps the original order and does not sort', () => {
    const list = [
      product({ id: 'z', name: 'Zebra' }),
      product({ id: 'y', name: 'Apple' }),
      product({ id: 'x', name: 'Mango' }),
    ];
    assert.deepEqual(ids(filterProducts(list, {})), ['z', 'y', 'x']);
  });

  it('does not modify its input', () => {
    const list = [product({ id: 'z', name: 'Zebra' }), product({ id: 'y', name: 'Apple', active: false })];
    const snapshot = structuredClone(list);
    const result = filterProducts(list, {});
    assert.deepEqual(list, snapshot);
    assert.notEqual(result, list);
    assert.deepEqual(ids(filterProducts(list, { includeInactive: true })), ['z', 'y']);
    assert.deepEqual(list, snapshot);
  });

  it('returns an empty array for no products', () => {
    assert.deepEqual(filterProducts([], { q: 'x' }), []);
  });
});

describe('listProducts with filterProducts', () => {
  it('still filters and sorts by name', () => {
    const app = createTestApp();
    addProduct(app.ctx, { name: 'Zebra mug', category: 'kitchen' });
    addProduct(app.ctx, { name: 'Apple mug', category: 'kitchen' });
    addProduct(app.ctx, { name: 'Beans', category: 'coffee' });
    const hidden = addProduct(app.ctx, { name: 'Hidden mug', category: 'kitchen' });
    app.ctx.store.products.update(hidden.id, { active: false });
    const names = (f: service.ProductFilter) => service.listProducts(app.ctx, f).map((p) => p.name);
    assert.deepEqual(names({}), ['Apple mug', 'Beans', 'Zebra mug']);
    assert.deepEqual(names({ category: 'kitchen', q: 'mug' }), ['Apple mug', 'Zebra mug']);
    assert.deepEqual(names({ category: 'kitchen', includeInactive: true }), ['Apple mug', 'Hidden mug', 'Zebra mug']);
  });
});
