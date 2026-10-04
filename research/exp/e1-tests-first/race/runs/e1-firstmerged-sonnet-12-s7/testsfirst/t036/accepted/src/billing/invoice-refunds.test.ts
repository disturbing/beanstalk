import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addCoupon, addProduct, createTestApp, signUp } from '../lib/testing.ts';
import type { TestApp } from '../lib/testing.ts';
import { markPaid } from './service.ts';
import type { Invoice, Order } from '../types.ts';

interface Refund {
  productId: string;
  amount: number;
  createdAt: string;
}

function setup(options: { discounted?: boolean; prices?: number[] } = {}) {
  const app = createTestApp();
  const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
  const customer = signUp(app.ctx, 'buyer@example.com');
  if (options.discounted) addCoupon(app.ctx, { id: 'REFUND10', kind: 'percent', value: 10 });
  const prices = options.prices ?? [2000, 2000, 2000];
  const products = prices.map((price) => addProduct(app.ctx, { price, stock: 100 }));
  app.ctx.store.carts.insert({
    id: customer.user.id,
    lines: products.map((p) => ({ productId: p.id, quantity: 1 })),
    updatedAt: app.ctx.clock.now().toISOString(),
  });
  const res = app.call('POST', '/checkout', {
    token: customer.token,
    body: { addressIndex: 0, couponCode: options.discounted ? 'REFUND10' : undefined },
  });
  assert.equal(res.status, 201);
  const order = res.body as Order;
  return { app, admin, customer, products, order, invoiceId: order.invoiceId! };
}

function invoiceOf(app: TestApp, id: string, token: string): Invoice & { refunds?: Refund[] } {
  return app.call('GET', `/invoices/${id}`, { token }).body as Invoice & { refunds?: Refund[] };
}

function refund(app: TestApp, invoiceId: string, token: string | undefined, productId: unknown) {
  return app.call('POST', `/invoices/${invoiceId}/refunds`, { token, body: { productId } });
}

describe('POST /invoices/:id/refunds', () => {
  it('refunds the line net minus its discount share plus its tax', () => {
    const { app, admin, products, invoiceId } = setup({ discounted: true, prices: [2000, 3000, 5000] });
    markPaid(app.ctx, invoiceId);
    const line = invoiceOf(app, invoiceId, admin.token).lines.find((l) => l.productId === products[1].id)!;
    assert.ok(line.discount > 0);
    assert.ok(line.tax > 0);

    const res = refund(app, invoiceId, admin.token, products[1].id);
    assert.equal(res.status, 201);
    const body = res.body as Refund;
    assert.equal(body.productId, products[1].id);
    assert.equal(body.amount, line.net - line.discount + line.tax);
    assert.equal(body.createdAt, app.clock.now().toISOString());
  });

  it('refunds identical amounts for three identical lines', () => {
    const { app, admin, products, invoiceId } = setup({ discounted: true });
    markPaid(app.ctx, invoiceId);
    const amounts = products.map((p) => (refund(app, invoiceId, admin.token, p.id).body as Refund).amount);
    assert.ok(amounts[0] > 0);
    assert.equal(amounts[1], amounts[0]);
    assert.equal(amounts[2], amounts[0]);
  });

  it('keeps the refund on the invoice in a refunds list', () => {
    const { app, admin, products, invoiceId } = setup();
    markPaid(app.ctx, invoiceId);
    const res = refund(app, invoiceId, admin.token, products[0].id);
    assert.equal(res.status, 201);
    const invoice = invoiceOf(app, invoiceId, admin.token);
    assert.equal(invoice.refunds?.length, 1);
    assert.deepEqual(invoice.refunds![0], res.body);
  });

  it('refunds a line only once', () => {
    const { app, admin, products, invoiceId } = setup();
    markPaid(app.ctx, invoiceId);
    assert.equal(refund(app, invoiceId, admin.token, products[0].id).status, 201);
    assert.equal(refund(app, invoiceId, admin.token, products[0].id).status, 409);
    assert.equal(refund(app, invoiceId, admin.token, products[1].id).status, 201);
    assert.equal(invoiceOf(app, invoiceId, admin.token).refunds?.length, 2);
  });

  it('rejects refunds on invoices that are not paid', () => {
    const { app, admin, products, invoiceId } = setup();
    assert.equal(refund(app, invoiceId, admin.token, products[0].id).status, 409);
  });

  it('answers 404 for a product that is not on the invoice', () => {
    const { app, admin, invoiceId } = setup();
    markPaid(app.ctx, invoiceId);
    assert.equal(refund(app, invoiceId, admin.token, 'prd_nope').status, 404);
  });

  it('is admin only', () => {
    const { app, admin, customer, products, invoiceId } = setup();
    markPaid(app.ctx, invoiceId);
    assert.equal(refund(app, invoiceId, customer.token, products[0].id).status, 403);
    assert.equal(refund(app, invoiceId, undefined, products[0].id).status, 401);
    assert.equal(invoiceOf(app, invoiceId, admin.token).refunds?.length ?? 0, 0);
  });
});
