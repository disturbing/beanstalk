import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reserve, setStock } from '../inventory/stock.ts';
import { addProduct, createTestApp, errorMessage, signUp } from '../lib/testing.ts';
import { addItem, getCart, setQuantity } from './service.ts';

function setup(stock: number, reserved = 0) {
  const app = createTestApp();
  const { user, token } = signUp(app.ctx);
  const product = addProduct(app.ctx, { stock });
  if (reserved > 0) reserve(app.ctx, [{ productId: product.id, quantity: reserved }]);
  return { app, user, token, product };
}

const qty = (app: ReturnType<typeof createTestApp>, userId: string, productId: string) =>
  getCart(app.ctx, userId).lines.find((l) => l.productId === productId)?.quantity;

describe('cart stock limit', () => {
  it('rejects adding more than is in stock with a 409', () => {
    const { app, user, token, product } = setup(3);
    const res = app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 50 } });
    assert.equal(res.status, 409);
    assert.equal(errorMessage(res), 'only 3 left in stock');
    assert.equal(qty(app, user.id, product.id), undefined);
  });

  it('allows adding exactly the available stock', () => {
    const { app, user, token, product } = setup(3);
    const res = app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 3 } });
    assert.equal(res.status, 201);
    assert.equal(qty(app, user.id, product.id), 3);
  });

  it('counts the units already in the cart line when adding', () => {
    const { app, user, token, product } = setup(5);
    addItem(app.ctx, user.id, product.id, 4);
    const res = app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 2 } });
    assert.equal(res.status, 409);
    assert.equal(errorMessage(res), 'only 5 left in stock');
    assert.equal(qty(app, user.id, product.id), 4);
    assert.equal(app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 1 } }).status, 201);
    assert.equal(qty(app, user.id, product.id), 5);
  });

  it('subtracts reserved units from what is available', () => {
    const { app, user, token, product } = setup(10, 7);
    const res = app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 4 } });
    assert.equal(res.status, 409);
    assert.equal(errorMessage(res), 'only 3 left in stock');
    assert.equal(app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 3 } }).status, 201);
    assert.equal(qty(app, user.id, product.id), 3);
  });

  it('never reports less than zero left', () => {
    const { app, token, product } = setup(10, 8);
    setStock(app.ctx, product.id, 5); // reserved (8) now exceeds on hand
    const res = app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 1 } });
    assert.equal(res.status, 409);
    assert.equal(errorMessage(res), 'only 0 left in stock');
  });

  it('rejects any add when nothing is in stock', () => {
    const { app, token, product } = setup(0);
    const res = app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 1 } });
    assert.equal(res.status, 409);
    assert.equal(errorMessage(res), 'only 0 left in stock');
  });

  it('rejects raising a line quantity above the available stock', () => {
    const { app, user, token, product } = setup(3);
    addItem(app.ctx, user.id, product.id, 1);
    const res = app.call('PATCH', `/cart/items/${product.id}`, { token, body: { quantity: 4 } });
    assert.equal(res.status, 409);
    assert.equal(errorMessage(res), 'only 3 left in stock');
    assert.equal(qty(app, user.id, product.id), 1);
  });

  it('allows raising a line quantity up to the available stock', () => {
    const { app, user, token, product } = setup(3);
    addItem(app.ctx, user.id, product.id, 1);
    const res = app.call('PATCH', `/cart/items/${product.id}`, { token, body: { quantity: 3 } });
    assert.equal(res.status, 200);
    assert.equal(qty(app, user.id, product.id), 3);
  });

  it('applies the limit in the service functions too', () => {
    const { app, user, product } = setup(3);
    assert.throws(
      () => addItem(app.ctx, user.id, product.id, 4),
      (err: any) => err.status === 409 && err.message === 'only 3 left in stock',
    );
    addItem(app.ctx, user.id, product.id, 1);
    assert.throws(
      () => setQuantity(app.ctx, user.id, product.id, 9),
      (err: any) => err.status === 409 && err.message === 'only 3 left in stock',
    );
  });

  it('always allows lowering a quantity, even when stock has dropped below it', () => {
    const { app, user, token, product } = setup(10);
    addItem(app.ctx, user.id, product.id, 6);
    setStock(app.ctx, product.id, 2);
    const res = app.call('PATCH', `/cart/items/${product.id}`, { token, body: { quantity: 4 } });
    assert.equal(res.status, 200);
    assert.equal(qty(app, user.id, product.id), 4);
    assert.equal(app.call('PATCH', `/cart/items/${product.id}`, { token, body: { quantity: 0 } }).status, 200);
    assert.equal(qty(app, user.id, product.id), undefined);
  });

  it('limits each product separately', () => {
    const { app, user, token, product } = setup(2);
    const other = addProduct(app.ctx, { stock: 100 });
    assert.equal(app.call('POST', '/cart/items', { token, body: { productId: other.id, quantity: 50 } }).status, 201);
    assert.equal(app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 3 } }).status, 409);
    assert.equal(qty(app, user.id, other.id), 50);
  });
});
