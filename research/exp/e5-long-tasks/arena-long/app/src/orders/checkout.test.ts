import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getCart } from '../cart/service.ts';
import { getStock, setStock } from '../inventory/stock.ts';
import { addProduct, createTestApp, ON_ADDRESS, placeOrder, signUp } from '../lib/testing.ts';

describe('checkout', () => {
  it('turns the cart into a confirmed, invoiced order and empties the cart', () => {
    const app = createTestApp();
    const { order, user } = placeOrder(app, { address: ON_ADDRESS, price: 5000, quantity: 2 });
    assert.equal(order.status, 'confirmed');
    assert.equal(order.number, 'BS-0001');
    assert.deepEqual({ subtotal: order.subtotal, tax: order.tax, discount: order.discount }, { subtotal: 10000, tax: 1300, discount: 0 });
    assert.equal(order.shippingAddress.region, 'ON');
    assert.equal(app.ctx.store.invoices.require(order.invoiceId!).orderId, order.id);
    assert.equal(getCart(app.ctx, user.id).lines.length, 0);
  });

  it('reserves stock for the ordered quantities', () => {
    const app = createTestApp();
    const { product } = placeOrder(app, { quantity: 3, stock: 10 });
    assert.equal(getStock(app.ctx, product.id).reserved, 3);
  });

  it('refuses to oversell and keeps the cart', () => {
    const app = createTestApp();
    const { token, user } = signUp(app.ctx);
    const product = addProduct(app.ctx, { stock: 5 });
    app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 2 } });
    setStock(app.ctx, product.id, 1); // someone else bought the rest
    const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
    assert.equal(res.status, 409);
    assert.equal(getCart(app.ctx, user.id).lines.length, 1);
  });

  it('applies a coupon and records its code', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { couponCode: 'WELCOME10', price: 5000, address: ON_ADDRESS });
    assert.deepEqual({ discount: order.discount, couponCode: order.couponCode }, { discount: 500, couponCode: 'WELCOME10' });
  });

  it('emails an order confirmation', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { email: 'carol@example.com' });
    assert.equal(app.mailer.sent.length, 1);
    assert.equal(app.mailer.sent[0].to, 'carol@example.com');
    assert.match(app.mailer.sent[0].subject, new RegExp(order.number));
  });

  it('requires a saved shipping address', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx, 'nowhere@example.com', { address: null });
    const product = addProduct(app.ctx);
    app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 1 } });
    const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
    assert.equal(res.status, 400);
    assert.equal((res.body as { error: { message: string } }).error.message, 'choose a saved shipping address');
  });
});
