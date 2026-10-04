import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp, errorMessage, placeOrder, signUp } from '../lib/testing.ts';
import type { TestApp } from '../lib/testing.ts';
import type { Invoice } from '../types.ts';
import { voidInvoice } from './service.ts';

/** Check out another order for an existing customer, a minute after the previous one. */
function checkoutAgain(app: TestApp, token: string): Invoice {
  app.clock.advance(60_000);
  app.call('POST', '/cart/items', { token, body: { productId: addProduct(app.ctx).id, quantity: 1 } });
  const order = app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
  assert.equal(order.status, 201);
  const res = app.call('GET', `/orders/${(order.body as { id: string }).id}/invoice`, { token });
  assert.equal(res.status, 200);
  return res.body as Invoice;
}

/** A customer with `count` invoices, oldest first. */
function customerWithInvoices(app: TestApp, count: number, email = 'buyer@example.com') {
  const placed = placeOrder(app, { email });
  const first = app.call('GET', `/orders/${placed.order.id}/invoice`, { token: placed.token }).body as Invoice;
  const invoices = [first];
  for (let i = 1; i < count; i++) invoices.push(checkoutAgain(app, placed.token));
  return { token: placed.token, user: placed.user, invoices };
}

const ids = (body: unknown) => (body as Invoice[]).map((i) => i.id);

describe('GET /invoices', () => {
  it('requires a signed-in user', () => {
    const app = createTestApp();
    assert.equal(app.call('GET', '/invoices').status, 401);
  });

  it('returns an empty array when the user has no invoices', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx);
    const res = app.call('GET', '/invoices', { token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });

  it('returns the full invoices, newest first', () => {
    const app = createTestApp();
    const { token, invoices } = customerWithInvoices(app, 3);
    const res = app.call('GET', '/invoices', { token });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.deepEqual(ids(res.body), [invoices[2]!.id, invoices[1]!.id, invoices[0]!.id]);
    assert.deepEqual(res.body, [invoices[2], invoices[1], invoices[0]]);
  });

  it("only returns the signed-in user's invoices", () => {
    const app = createTestApp();
    const mine = customerWithInvoices(app, 2, 'me@example.com');
    const theirs = customerWithInvoices(app, 1, 'other@example.com');
    const res = app.call('GET', '/invoices', { token: mine.token });
    assert.deepEqual(ids(res.body).sort(), mine.invoices.map((i) => i.id).sort());
    const other = app.call('GET', '/invoices', { token: theirs.token });
    assert.deepEqual(ids(other.body), [theirs.invoices[0]!.id]);
  });
});

describe('GET /invoices status filter', () => {
  function setup() {
    const app = createTestApp();
    const { token, invoices } = customerWithInvoices(app, 4);
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    assert.equal(app.call('POST', `/invoices/${invoices[0]!.id}/pay`, { token: admin.token }).status, 200);
    assert.equal(app.call('POST', `/invoices/${invoices[1]!.id}/pay`, { token: admin.token }).status, 200);
    voidInvoice(app.ctx, invoices[2]!.id);
    return { app, token, invoices };
  }

  it('filters by open', () => {
    const { app, token, invoices } = setup();
    const res = app.call('GET', '/invoices', { token, query: { status: 'open' } });
    assert.equal(res.status, 200);
    assert.deepEqual(ids(res.body), [invoices[3]!.id]);
  });

  it('filters by paid, newest first', () => {
    const { app, token, invoices } = setup();
    const res = app.call('GET', '/invoices', { token, query: { status: 'paid' } });
    assert.equal(res.status, 200);
    assert.deepEqual(ids(res.body), [invoices[1]!.id, invoices[0]!.id]);
  });

  it('filters by void', () => {
    const { app, token, invoices } = setup();
    const res = app.call('GET', '/invoices', { token, query: { status: 'void' } });
    assert.equal(res.status, 200);
    assert.deepEqual(ids(res.body), [invoices[2]!.id]);
  });

  it('returns every status without a filter', () => {
    const { app, token } = setup();
    const res = app.call('GET', '/invoices', { token });
    assert.equal((res.body as unknown[]).length, 4);
  });

  it('rejects an unknown status with 400', () => {
    const { app, token } = setup();
    for (const status of ['pending', 'PAID', 'overdue']) {
      const res = app.call('GET', '/invoices', { token, query: { status } });
      assert.equal(res.status, 400, `status=${status}`);
      assert.ok(errorMessage(res).length > 0);
    }
  });
});

describe('GET /invoices paging', () => {
  it('honours limit', () => {
    const app = createTestApp();
    const { token, invoices } = customerWithInvoices(app, 5);
    const res = app.call('GET', '/invoices', { token, query: { limit: '2' } });
    assert.equal(res.status, 200);
    assert.deepEqual(ids(res.body), [invoices[4]!.id, invoices[3]!.id]);
  });

  it('honours offset together with limit', () => {
    const app = createTestApp();
    const { token, invoices } = customerWithInvoices(app, 5);
    const res = app.call('GET', '/invoices', { token, query: { limit: '2', offset: '2' } });
    assert.deepEqual(ids(res.body), [invoices[2]!.id, invoices[1]!.id]);
  });

  it('returns an empty array past the end', () => {
    const app = createTestApp();
    const { token } = customerWithInvoices(app, 2);
    const res = app.call('GET', '/invoices', { token, query: { offset: '10' } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });

  it('pages within a status filter', () => {
    const app = createTestApp();
    const { token, invoices } = customerWithInvoices(app, 4);
    voidInvoice(app.ctx, invoices[3]!.id);
    const res = app.call('GET', '/invoices', { token, query: { status: 'open', limit: '1', offset: '1' } });
    assert.deepEqual(ids(res.body), [invoices[1]!.id]);
  });

  it('sends x-total-count like the other list endpoints', () => {
    const app = createTestApp();
    const { token } = customerWithInvoices(app, 3);
    const res = app.call('GET', '/invoices', { token, query: { limit: '1' } });
    assert.equal(res.headers['x-total-count'], '3');
  });
});
