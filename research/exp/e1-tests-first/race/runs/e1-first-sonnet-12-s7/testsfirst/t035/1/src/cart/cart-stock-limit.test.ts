import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp, errorMessage, signUp } from '../lib/testing.ts';
import { setStock } from '../inventory/stock.ts';

function setup(stock: number, reserved = 0) {
  const app = createTestApp();
  const { token } = signUp(app.ctx);
  const product = addProduct(app.ctx, { stock });
  if (reserved) app.ctx.store.stock.update(product.id, { reserved });
  const add = (quantity: number) => app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity } });
  const set = (quantity: number) =>
    app.call('PATCH', `/cart/items/${product.id}`, { token, body: { quantity } });
  const lines = () => (app.call('GET', '/cart', { token }).body as { lines: { quantity: number }[] }).lines;
  return { app, product, add, set, lines };
}

describe('cart stock limits', () => {
  it('rejects adding more than is in stock with a 409', () => {
    const { add, lines } = setup(3);
    const res = add(50);
    assert.equal(res.status, 409);
    assert.equal(errorMessage(res), 'only 3 left in stock');
    assert.equal(lines().length, 0);
  });

  it('allows adding exactly the available stock', () => {
    const { add, lines } = setup(3);
    assert.equal(add(3).status, 201);
    assert.equal(lines()[0].quantity, 3);
  });

  it('counts the quantity already in the cart when adding again', () => {
    const { add, lines } = setup(5);
    assert.equal(add(3).status, 201);
    const res = add(3);
    assert.equal(res.status, 409);
    assert.equal(errorMessage(res), 'only 5 left in stock');
    assert.equal(lines()[0].quantity, 3);
    assert.equal(add(2).status, 201);
    assert.equal(lines()[0].quantity, 5);
  });

  it('subtracts reserved units from what is available', () => {
    const { add } = setup(10, 7);
    const res = add(4);
    assert.equal(res.status, 409);
    assert.equal(errorMessage(res), 'only 3 left in stock');
    assert.equal(add(3).status, 201);
  });

  it('never reports a negative number left', () => {
    const { add } = setup(5, 8);
    const res = add(1);
    assert.equal(res.status, 409);
    assert.equal(errorMessage(res), 'only 0 left in stock');
  });

  it('rejects any add when nothing is in stock', () => {
    const { app, add, product } = setup(3);
    setStock(app.ctx, product.id, 0);
    const res = add(1);
    assert.equal(res.status, 409);
    assert.equal(errorMessage(res), 'only 0 left in stock');
  });

  it('rejects raising a line above the available stock', () => {
    const { add, set, lines } = setup(4);
    add(2);
    const res = set(5);
    assert.equal(res.status, 409);
    assert.equal(errorMessage(res), 'only 4 left in stock');
    assert.equal(lines()[0].quantity, 2);
  });

  it('allows setting a line up to the available stock', () => {
    const { add, set, lines } = setup(4);
    add(2);
    assert.equal(set(4).status, 200);
    assert.equal(lines()[0].quantity, 4);
  });

  it('allows lowering a quantity even when it still exceeds the stock', () => {
    const { app, product, add, set, lines } = setup(10);
    add(8);
    setStock(app.ctx, product.id, 3);
    assert.equal(set(5).status, 200);
    assert.equal(lines()[0].quantity, 5);
    assert.equal(set(0).status, 200);
    assert.equal(lines().length, 0);
  });
});
