import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp, signUp } from '../lib/testing.ts';
import { addItem, clearCart, getCart } from './service.ts';

function setup() {
  const app = createTestApp();
  const { user, token } = signUp(app.ctx);
  return { app, user, token };
}

describe('cart', () => {
  it('adds products and merges repeated adds into one line', () => {
    const { app, user } = setup();
    const product = addProduct(app.ctx);
    addItem(app.ctx, user.id, product.id, 1);
    addItem(app.ctx, user.id, product.id, 2);
    assert.deepEqual(getCart(app.ctx, user.id).lines, [{ productId: product.id, quantity: 3 }]);
  });

  it('prices lines from the catalog', () => {
    const { app, token } = setup();
    const a = addProduct(app.ctx, { price: 1500 });
    const b = addProduct(app.ctx, { price: 250 });
    app.call('POST', '/cart/items', { token, body: { productId: a.id, quantity: 2 } });
    app.call('POST', '/cart/items', { token, body: { productId: b.id, quantity: 4 } });
    const cart = app.call('GET', '/cart', { token }).body as { subtotal: number; lines: unknown[] };
    assert.equal(cart.subtotal, 4000);
    assert.equal(cart.lines.length, 2);
  });

  it('sets exact quantities and removes a line at zero', () => {
    const { app, token } = setup();
    const product = addProduct(app.ctx);
    app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 5 } });
    const path = `/cart/items/${product.id}`;
    assert.equal((app.call('PATCH', path, { token, body: { quantity: 2 } }).body as { subtotal: number }).subtotal, 4000);
    assert.equal((app.call('PATCH', path, { token, body: { quantity: 0 } }).body as { lines: unknown[] }).lines.length, 0);
    assert.equal(app.call('PATCH', path, { token, body: { quantity: 1 } }).status, 400);
  });

  it('removes items and clears the cart', () => {
    const { app, user, token } = setup();
    const product = addProduct(app.ctx);
    app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 1 } });
    assert.equal(app.call('DELETE', `/cart/items/${product.id}`, { token }).status, 200);
    assert.equal(getCart(app.ctx, user.id).lines.length, 0);
    addItem(app.ctx, user.id, product.id, 1);
    clearCart(app.ctx, user.id);
    assert.equal(app.ctx.store.carts.get(user.id), undefined);
  });

  it('refuses inactive products, bad quantities and overfull carts', () => {
    const { app, user, token } = setup();
    const product = addProduct(app.ctx);
    const retired = addProduct(app.ctx);
    app.ctx.store.products.update(retired.id, { active: false });
    assert.equal(app.call('POST', '/cart/items', { token, body: { productId: retired.id, quantity: 1 } }).status, 400);
    assert.equal(app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 0 } }).status, 400);
    app.ctx.config.maxCartLines = 1;
    addItem(app.ctx, user.id, product.id, 1);
    assert.throws(() => addItem(app.ctx, user.id, addProduct(app.ctx).id, 1), /cart is full/);
  });

});
