import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, signUp } from '../lib/testing.ts';
import type { TestApp } from '../lib/testing.ts';
import type { Invoice, InvoiceStatus } from '../types.ts';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type Entry = Invoice & { daysOverdue: number };

/** Insert an invoice due `offsetMs` from the app clock's now (negative = already due). */
function addInvoice(app: TestApp, offsetMs: number, status: InvoiceStatus = 'open'): Invoice {
  const now = app.clock.now().getTime();
  const id = app.ctx.store.nextId('inv');
  return app.ctx.store.invoices.insert({
    id,
    number: `INV-T-${id}`,
    orderId: `ord_${id}`,
    userId: 'usr_0001',
    currency: 'CAD',
    lines: [],
    subtotal: 1000,
    discount: 0,
    couponCode: null,
    tax: 0,
    total: 1000,
    status,
    issuedAt: new Date(now - 60 * DAY_MS).toISOString(),
    dueAt: new Date(now + offsetMs).toISOString(),
    paidAt: status === 'paid' ? new Date(now - DAY_MS).toISOString() : null,
  } as Invoice);
}

function overdue(app: TestApp): Entry[] {
  const { token } = signUp(app.ctx, 'admin@example.com', { admin: true });
  const res = app.call('GET', '/invoices/overdue', { token });
  assert.equal(res.status, 200);
  return res.body as Entry[];
}

describe('GET /invoices/overdue', () => {
  it('is admin only', () => {
    const app = createTestApp();
    addInvoice(app, -5 * DAY_MS);
    assert.equal(app.call('GET', '/invoices/overdue').status, 401);
    const { token } = signUp(app.ctx, 'customer@example.com');
    assert.equal(app.call('GET', '/invoices/overdue', { token }).status, 403);
  });

  it('returns an empty list when nothing is overdue', () => {
    const app = createTestApp();
    addInvoice(app, 5 * DAY_MS);
    assert.deepEqual(overdue(app), []);
  });

  it('lists open invoices past their due date with daysOverdue, longest overdue first', () => {
    const app = createTestApp();
    const a = addInvoice(app, -3 * DAY_MS);
    const b = addInvoice(app, -10 * DAY_MS);
    const c = addInvoice(app, -6 * DAY_MS);
    const list = overdue(app);
    assert.deepEqual(list.map((i) => i.id), [b.id, c.id, a.id]);
    assert.deepEqual(list.map((i) => i.daysOverdue), [10, 6, 3]);
    assert.equal(list[0].number, b.number);
    assert.equal(list[0].total, b.total);
  });

  it('excludes paid and void invoices', () => {
    const app = createTestApp();
    addInvoice(app, -10 * DAY_MS, 'paid');
    addInvoice(app, -10 * DAY_MS, 'void');
    const open = addInvoice(app, -2 * DAY_MS);
    assert.deepEqual(overdue(app).map((i) => i.id), [open.id]);
  });

  it('excludes invoices that are not yet due', () => {
    const app = createTestApp();
    addInvoice(app, 1 * DAY_MS);
    addInvoice(app, 1 * HOUR_MS);
    const late = addInvoice(app, -1 * DAY_MS);
    assert.deepEqual(overdue(app).map((i) => i.id), [late.id]);
  });

  it('counts whole days, rounding down', () => {
    const app = createTestApp();
    const a = addInvoice(app, -(3 * DAY_MS + 23 * HOUR_MS));
    const b = addInvoice(app, -(2 * DAY_MS));
    const list = overdue(app);
    assert.deepEqual(list.map((i) => [i.id, i.daysOverdue]), [[a.id, 3], [b.id, 2]]);
  });

  it('reports at least 1 day for an invoice that is only hours overdue', () => {
    const app = createTestApp();
    const a = addInvoice(app, -HOUR_MS);
    const list = overdue(app);
    assert.deepEqual(list.map((i) => [i.id, i.daysOverdue]), [[a.id, 1]]);
  });

  it('follows the clock', () => {
    const app = createTestApp();
    const a = addInvoice(app, 2 * DAY_MS);
    assert.deepEqual(overdue(app), []);
    app.clock.advance(5 * DAY_MS);
    const list = overdue(app);
    assert.deepEqual(list.map((i) => [i.id, i.daysOverdue]), [[a.id, 3]]);
  });
});
