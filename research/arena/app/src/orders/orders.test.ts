import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getStock } from '../inventory/stock.ts';
import { createTestApp, placeOrder, signUp } from '../lib/testing.ts';
import type { Order } from '../types.ts';

describe('orders', () => {
  it('lists only the caller\'s orders, newest first', () => {
    const app = createTestApp();
    const first = placeOrder(app, { email: 'a@example.com' });
    placeOrder(app, { email: 'b@example.com' });
    app.clock.advance(60_000);
    app.call('POST', '/cart/items', { token: first.token, body: { productId: first.product.id, quantity: 1 } });
    const second = app.call('POST', '/checkout', { token: first.token, body: { addressIndex: 0 } }).body as Order;
    const list = app.call('GET', '/orders', { token: first.token }).body as Order[];
    assert.deepEqual(list.map((o) => o.id), [second.id, first.order.id]);
  });

  it('hides other customers\' orders but not from admins', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app);
    const stranger = signUp(app.ctx, 'stranger@example.com');
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    assert.equal(app.call('GET', `/orders/${order.id}`, { token }).status, 200);
    assert.equal(app.call('GET', `/orders/${order.id}`, { token: stranger.token }).status, 404);
    assert.equal(app.call('GET', `/orders/${order.id}`, { token: admin.token }).status, 200);
  });

  it('cancelling releases stock, voids the invoice and tells the customer', () => {
    const app = createTestApp();
    const { order, token, product } = placeOrder(app, { quantity: 2 });
    const res = app.call('POST', `/orders/${order.id}/cancel`, { token });
    assert.equal((res.body as Order).status, 'cancelled');
    assert.equal(getStock(app.ctx, product.id).reserved, 0);
    assert.equal(app.ctx.store.invoices.require(order.invoiceId!).status, 'void');
    assert.match(app.mailer.sent.at(-1)!.subject, /was cancelled/);
  });

  it('cannot cancel an order that has shipped, or one that is not yours', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app);
    const stranger = signUp(app.ctx, 'stranger@example.com');
    assert.equal(app.call('POST', `/orders/${order.id}/cancel`, { token: stranger.token }).status, 404);
    app.ctx.store.orders.update(order.id, { status: 'shipped' });
    assert.equal(app.call('POST', `/orders/${order.id}/cancel`, { token }).status, 409);
  });

});
