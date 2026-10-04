import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, placeOrder, signUp } from '../lib/testing.ts';
import type { TestApp } from '../lib/testing.ts';
import type { Invoice } from '../types.ts';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Place an order and move its invoice's due date to `offsetMs` from now (negative = in the past). */
function invoiceDue(app: TestApp, offsetMs: number, status: Invoice['status'] = 'open', n = 0): Invoice {
  const { order } = placeOrder(app, { email: `buyer${n}-${Math.abs(offsetMs)}@example.com` });
  const dueAt = new Date(app.clock.now().getTime() + offsetMs).toISOString();
  return app.ctx.store.invoices.update(order.invoiceId, {
    dueAt,
    status,
    paidAt: status === 'paid' ? app.clock.now().toISOString() : null,
  });
}

function overdue(app: TestApp, token: string): Array<Invoice & { daysOverdue: number }> {
  const res = app.call('GET', '/invoices/overdue', { token });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  return res.body as Array<Invoice & { daysOverdue: number }>;
}

describe('GET /invoices/overdue', () => {
  it('requires authentication and an admin', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx, 'customer@example.com');
    assert.equal(app.call('GET', '/invoices/overdue').status, 401);
    assert.equal(app.call('GET', '/invoices/overdue', { token }).status, 403);
  });

  it('is empty when nothing is overdue', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx, 'admin@example.com', { admin: true });
    invoiceDue(app, 5 * DAY_MS);
    assert.deepEqual(overdue(app, token), []);
  });

  it('lists only open invoices whose due date has passed', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx, 'admin@example.com', { admin: true });
    const late = invoiceDue(app, -3 * DAY_MS, 'open', 1);
    invoiceDue(app, 3 * DAY_MS, 'open', 2);
    invoiceDue(app, -3 * DAY_MS, 'paid', 3);
    invoiceDue(app, -3 * DAY_MS, 'void', 4);
    const list = overdue(app, token);
    assert.deepEqual(list.map((i) => i.id), [late.id]);
  });

  it('returns the invoice fields plus daysOverdue', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx, 'admin@example.com', { admin: true });
    const late = invoiceDue(app, -3 * DAY_MS);
    const [entry] = overdue(app, token);
    assert.deepEqual(entry, { ...late, daysOverdue: 3 });
  });

  it('orders the longest overdue first', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx, 'admin@example.com', { admin: true });
    const mid = invoiceDue(app, -5 * DAY_MS, 'open', 1);
    const newest = invoiceDue(app, -1 * DAY_MS, 'open', 2);
    const oldest = invoiceDue(app, -20 * DAY_MS, 'open', 3);
    assert.deepEqual(overdue(app, token).map((i) => i.id), [oldest.id, mid.id, newest.id]);
  });

  it('counts whole days overdue, rounding down', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx, 'admin@example.com', { admin: true });
    const a = invoiceDue(app, -(2 * DAY_MS + 23 * HOUR_MS), 'open', 1);
    const b = invoiceDue(app, -DAY_MS, 'open', 2);
    const byId = new Map(overdue(app, token).map((i) => [i.id, i.daysOverdue]));
    assert.equal(byId.get(a.id), 2);
    assert.equal(byId.get(b.id), 1);
  });

  it('reports at least 1 day for an invoice that fell due less than a day ago', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx, 'admin@example.com', { admin: true });
    const a = invoiceDue(app, -HOUR_MS, 'open', 1);
    const b = invoiceDue(app, -(DAY_MS - 1000), 'open', 2);
    const byId = new Map(overdue(app, token).map((i) => [i.id, i.daysOverdue]));
    assert.equal(byId.get(a.id), 1);
    assert.equal(byId.get(b.id), 1);
  });

  it('follows the clock', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx, 'admin@example.com', { admin: true });
    const inv = invoiceDue(app, DAY_MS);
    assert.deepEqual(overdue(app, token), []);
    app.clock.advance(4 * DAY_MS);
    const [entry] = overdue(app, token);
    assert.equal(entry.id, inv.id);
    assert.equal(entry.daysOverdue, 3);
  });
});
