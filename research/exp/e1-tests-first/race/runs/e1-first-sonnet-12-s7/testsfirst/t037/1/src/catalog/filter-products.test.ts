import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp } from '../lib/testing.ts';
import * as service from './service.ts';
import type { Product } from '../types.ts';
import type { ProductFilter } from './service.ts';

type FilterFn = (products: Product[], filter: ProductFilter) => Product[];
const filterProducts = (products: Product[], filter: ProductFilter): Product[] =>
  (service as unknown as { filterProducts: FilterFn }).filterProducts(products, filter);

function fixture() {
  const app = createTestApp();
  const beans = addProduct(app.ctx, { name: 'Dark roast beans', category: 'coffee' });
  const mug = addProduct(app.ctx, { name: 'Blue mug', category: 'kitchen', description: 'Holds dark roast well' });
  const old = addProduct(app.ctx, { name: 'Old kettle', category: 'kitchen' });
  const retired = app.ctx.store.products.update(old.id, { active: false });
  const tea = addProduct(app.ctx, { name: 'Green tea', category: 'coffee' });
  return { app, products: [tea, retired, mug, beans] as Product[], beans, mug, retired, tea };
}

const ids = (ps: Product[]) => ps.map((p) => p.id);

describe('filterProducts', () => {
  it('is exported as a function', () => {
    assert.equal(typeof (service as Record<string, unknown>).filterProducts, 'function');
  });

  it('drops inactive products by default and keeps original order', () => {
    const { products, tea, mug, beans } = fixture();
    assert.deepEqual(ids(filterProducts(products, {})), ids([tea, mug, beans]));
  });

  it('keeps inactive products with includeInactive', () => {
    const { products } = fixture();
    assert.deepEqual(ids(filterProducts(products, { includeInactive: true })), ids(products));
  });

  it('filters by category', () => {
    const { products, tea, beans } = fixture();
    assert.deepEqual(ids(filterProducts(products, { category: 'coffee' })), ids([tea, beans]));
  });

  it('filters by search words across name and description', () => {
    const { products, mug, beans } = fixture();
    assert.deepEqual(ids(filterProducts(products, { q: 'dark roast' })), ids([mug, beans]));
  });

  it('combines category, q and includeInactive', () => {
    const { products, mug, retired } = fixture();
    assert.deepEqual(ids(filterProducts(products, { category: 'kitchen', q: 'dark' })), ids([mug]));
    assert.deepEqual(ids(filterProducts(products, { category: 'kitchen', includeInactive: true })), ids([retired, mug]));
  });

  it('does not modify the input array or its products', () => {
    const { products } = fixture();
    const snapshot = structuredClone(products);
    const out = filterProducts(products, { category: 'coffee' });
    assert.notEqual(out, products);
    assert.deepEqual(products, snapshot);
  });

  it('returns a new array even when nothing is filtered out', () => {
    const { products } = fixture();
    const out = filterProducts(products, { includeInactive: true });
    assert.notEqual(out, products);
    assert.equal(out.length, products.length);
  });

  it('returns an empty array for no products', () => {
    assert.deepEqual(filterProducts([], { q: 'x' }), []);
  });
});

describe('listProducts with filterProducts', () => {
  it('still sorts by name and applies the same rules', () => {
    const { app, tea, beans } = fixture();
    const listed = service.listProducts(app.ctx, {});
    assert.deepEqual(listed.map((p) => p.name), ['Blue mug', 'Dark roast beans', 'Green tea']);
    assert.deepEqual(ids(service.listProducts(app.ctx, { category: 'coffee' })), ids([beans, tea]));
    assert.deepEqual(service.listProducts(app.ctx, { q: 'dark roast' }).map((p) => p.name), ['Blue mug', 'Dark roast beans']);
  });
});
