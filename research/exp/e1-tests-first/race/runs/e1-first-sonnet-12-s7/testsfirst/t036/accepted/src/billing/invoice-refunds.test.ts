import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp, errorMessage, ON_ADDRESS, signUp } from '../lib/testing.ts';
import type { TestApp } from '../lib/testing.ts';
import type { Invoice } from '../types.ts';

/** A customer checks out three identical $20.00 lines (optionally with a coupon); an admin is on hand. */
function setup(couponCode?: string) {
  const app = createTestApp();
  const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
  const { token } = signUp(app.ctx, 'buyer@example.com', { address: ON_ADDRESS });
  const products = [0, 1, 2].map(() => addProduct(app.ctx, { price: 2000 }));
  for (const p of products) {
    app.call('POST', '/cart/items', { token, body: { productId: p.id, quantity: 1 } });
  }
  const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0, couponCode } });
  assert.equal(res.status, 201);
  const invoiceId = (res.body as { invoiceId: string }).invoiceId;
  return { app, admin, token, products, invoiceId };
}

function pay(app: TestApp, token: string, invoiceId: string) {
  assert.equal(app.call('POST', `/invoices/${invoiceId}/pay`, { token }).status, 200);
}

const getInvoice = (app: TestApp, token: string, id: string) =>
  app.call('GET', `/invoices/${id}`, { token }).body as Invoice & { refunds: Array<Record<string, unknown>> };

describe('POST /invoices/:id/refunds', () => {
  it('refunds a line: net minus its discount share plus its tax', () => {
    const { app, admin, products, invoiceId } = setup('WELCOME10');
    pay(app, admin.token, invoiceId);
    const invoice = getInvoice(app, admin.token, invoiceId);
    const line = invoice.lines.find((l) => l.productId === products[0].id)!;
    const expected = line.net - line.discount + line.tax;

    const res = app.call('POST', `/invoices/${invoiceId}/refunds`, {
      token: admin.token,
      body: { productId: products[0].id },
    });
    assert.equal(res.status, 201);
    const body = res.body as { productId: string; amount: number; createdAt: string };
    assert.equal(body.productId, products[0].id);
    assert.equal(body.amount, expected);
    assert.equal(body.createdAt, app.clock.now().toISOString());
  });

  it('refunds identical lines identical amounts', () => {
    const { app, admin, products, invoiceId } = setup();
    pay(app, admin.token, invoiceId);
    const amounts = products.map(
      (p) =>
        (app.call('POST', `/invoices/${invoiceId}/refunds`, { token: admin.token, body: { productId: p.id } })
          .body as { amount: number }).amount,
    );
    assert.equal(amounts[0], 2000 + 260);
    assert.deepEqual(amounts, [amounts[0], amounts[0], amounts[0]]);
  });

  it('keeps refunds on the invoice', () => {
    const { app, admin, products, invoiceId } = setup();
    pay(app, admin.token, invoiceId);
    assert.deepEqual(getInvoice(app, admin.token, invoiceId).refunds ?? [], []);
    app.call('POST', `/invoices/${invoiceId}/refunds`, { token: admin.token, body: { productId: products[1].id } });
    const refunds = getInvoice(app, admin.token, invoiceId).refunds;
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].productId, products[1].id);
    assert.equal(refunds[0].amount, 2260);
  });

  it('is admin only', () => {
    const { app, token, products, invoiceId, admin } = setup();
    pay(app, admin.token, invoiceId);
    const res = app.call('POST', `/invoices/${invoiceId}/refunds`, { token, body: { productId: products[0].id } });
    assert.equal(res.status, 403);
  });

  it('rejects an invoice that is not paid with 409', () => {
    const { app, admin, products, invoiceId } = setup();
    const res = app.call('POST', `/invoices/${invoiceId}/refunds`, {
      token: admin.token,
      body: { productId: products[0].id },
    });
    assert.equal(res.status, 409);
    assert.ok(errorMessage(res).length > 0);
  });

  it('refuses to refund the same line twice with 409', () => {
    const { app, admin, products, invoiceId } = setup();
    pay(app, admin.token, invoiceId);
    const call = (productId: string) =>
      app.call('POST', `/invoices/${invoiceId}/refunds`, { token: admin.token, body: { productId } });
    assert.equal(call(products[0].id).status, 201);
    assert.equal(call(products[0].id).status, 409);
    assert.equal(call(products[1].id).status, 201);
    assert.equal(getInvoice(app, admin.token, invoiceId).refunds.length, 2);
  });

  it('answers 404 for a product that is not on the invoice', () => {
    const { app, admin, invoiceId, products } = setup();
    pay(app, admin.token, invoiceId);
    const ok = app.call('POST', `/invoices/${invoiceId}/refunds`, {
      token: admin.token,
      body: { productId: products[0].id },
    });
    assert.equal(ok.status, 201);
    const res = app.call('POST', `/invoices/${invoiceId}/refunds`, {
      token: admin.token,
      body: { productId: 'prd_9999' },
    });
    assert.equal(res.status, 404);
  });
});
