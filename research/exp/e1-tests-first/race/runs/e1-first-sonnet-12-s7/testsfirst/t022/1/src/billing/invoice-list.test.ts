import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { markPaid, voidInvoice } from './service.ts';
import { addProduct, createTestApp, errorMessage, placeOrder, signUp } from '../lib/testing.ts';
import type { TestApp } from '../lib/testing.ts';
import type { Invoice } from '../types.ts';

/** A further order for an existing customer, a minute after the previous one. */
function orderAgain(app: TestApp, token: string): Invoice {
  app.clock.advance(60 * 1000);
  const product = addProduct(app.ctx);
  app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 1 } });
  const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
  assert.equal(res.status, 201);
  const invoiceId = (res.body as { invoiceId: string }).invoiceId;
  return app.ctx.store.invoices.require(invoiceId);
}

/** A customer with `count` invoices, oldest first. */
function customerWithInvoices(app: TestApp, count: number, email = 'buyer@example.com') {
  const first = placeOrder(app, { email });
  const invoices = [app.ctx.store.invoices.require(first.order.invoiceId!)];
  while (invoices.length < count) invoices.push(orderAgain(app, first.token));
  return { token: first.token, user: first.user, invoices };
}

const ids = (body: unknown) => (body as Invoice[]).map((i) => i.id);

describe('GET /invoices', () => {
  it("lists the signed-in user's invoices, newest first", () => {
    const app = createTestApp();
    const { token, invoices } = customerWithInvoices(app, 3);
    const res = app.call('GET', '/invoices', { token });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.deepEqual(ids(res.body), invoices.map((i) => i.id).reverse());
  });

  it('returns full invoices', () => {
    const app = createTestApp();
    const { token, invoices } = customerWithInvoices(app, 1);
    const res = app.call('GET', '/invoices', { token });
    assert.deepEqual(res.body, [invoices[0]]);
  });

  it("only includes the user's own invoices, even for admins", () => {
    const app = createTestApp();
    const mine = customerWithInvoices(app, 2, 'mine@example.com');
    const other = customerWithInvoices(app, 1, 'other@example.com');
    assert.deepEqual(
      ids(app.call('GET', '/invoices', { token: mine.token }).body),
      mine.invoices.map((i) => i.id).reverse(),
    );
    assert.deepEqual(ids(app.call('GET', '/invoices', { token: other.token }).body), [other.invoices[0].id]);
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    assert.deepEqual(app.call('GET', '/invoices', { token: admin.token }).body, []);
  });

  it('returns an empty array when the user has no invoices', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx, 'new@example.com');
    const res = app.call('GET', '/invoices', { token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });

  it('requires a signed-in user', () => {
    const app = createTestApp();
    assert.equal(app.call('GET', '/invoices').status, 401);
  });
});

describe('GET /invoices status filter', () => {
  function setup() {
    const app = createTestApp();
    const { token, invoices } = customerWithInvoices(app, 4);
    markPaid(app.ctx, invoices[0].id);
    voidInvoice(app.ctx, invoices[1].id);
    markPaid(app.ctx, invoices[2].id);
    return { app, token, invoices };
  }

  it('filters by each status, newest first', () => {
    const { app, token, invoices } = setup();
    const list = (status: string) => ids(app.call('GET', '/invoices', { token, query: { status } }).body);
    assert.deepEqual(list('paid'), [invoices[2].id, invoices[0].id]);
    assert.deepEqual(list('void'), [invoices[1].id]);
    assert.deepEqual(list('open'), [invoices[3].id]);
  });

  it('rejects any other status with 400', () => {
    const { app, token } = setup();
    for (const status of ['refunded', 'PAID', '']) {
      const res = app.call('GET', '/invoices', { token, query: { status } });
      assert.equal(res.status, 400, `status=${JSON.stringify(status)}`);
      assert.ok(errorMessage(res).length > 0);
    }
  });
});

describe('GET /invoices paging', () => {
  it('applies limit and offset to the newest-first list', () => {
    const app = createTestApp();
    const { token, invoices } = customerWithInvoices(app, 5);
    const newest = invoices.map((i) => i.id).reverse();
    const page = (query: Record<string, string>) => app.call('GET', '/invoices', { token, query });
    assert.deepEqual(ids(page({ limit: '2' }).body), newest.slice(0, 2));
    assert.deepEqual(ids(page({ limit: '2', offset: '2' }).body), newest.slice(2, 4));
    assert.deepEqual(ids(page({ limit: '2', offset: '4' }).body), newest.slice(4));
    assert.deepEqual(ids(page({ offset: '10' }).body), []);
  });

  it('pages within a status filter and reports the total count', () => {
    const app = createTestApp();
    const { token, invoices } = customerWithInvoices(app, 4);
    for (const i of invoices.slice(0, 3)) markPaid(app.ctx, i.id);
    const res = app.call('GET', '/invoices', { token, query: { status: 'paid', limit: '1', offset: '1' } });
    assert.equal(res.status, 200);
    assert.deepEqual(ids(res.body), [invoices[1].id]);
    assert.equal(res.headers['x-total-count'], '3');
  });
});
