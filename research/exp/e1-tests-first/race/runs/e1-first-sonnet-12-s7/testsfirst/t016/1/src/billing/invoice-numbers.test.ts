import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, placeOrder } from '../lib/testing.ts';
import type { TestApp } from '../lib/testing.ts';
import { getInvoice } from './service.ts';

function moveTo(app: TestApp, iso: string): void {
  app.clock.advance(new Date(iso).getTime() - app.clock.now().getTime());
}

let buyers = 0;
function issue(app: TestApp) {
  buyers += 1;
  const { order } = placeOrder(app, { email: `buyer${buyers}@example.com` });
  return getInvoice(app.ctx, order.invoiceId!);
}

describe('invoice numbers', () => {
  it('use the year of issue and a four-digit sequence starting at 0001', () => {
    const app = createTestApp();
    assert.equal(issue(app).number, 'INV-2026-0001');
    assert.equal(issue(app).number, 'INV-2026-0002');
    assert.equal(issue(app).number, 'INV-2026-0003');
  });

  it('restart at 0001 in a new year', () => {
    const app = createTestApp();
    issue(app);
    issue(app);
    moveTo(app, '2027-01-01T00:00:00.000Z');
    assert.equal(issue(app).number, 'INV-2027-0001');
    assert.equal(issue(app).number, 'INV-2027-0002');
  });

  it('switch year at midnight UTC', () => {
    const app = createTestApp();
    moveTo(app, '2026-12-31T23:59:59.000Z');
    assert.equal(issue(app).number, 'INV-2026-0001');
    moveTo(app, '2027-01-01T00:00:00.000Z');
    const invoice = issue(app);
    assert.equal(invoice.issuedAt, '2027-01-01T00:00:00.000Z');
    assert.equal(invoice.number, 'INV-2027-0001');
  });

  it('keep the sequence zero-padded to four digits as it grows', () => {
    const app = createTestApp();
    const numbers = Array.from({ length: 12 }, () => issue(app).number);
    assert.equal(numbers[9], 'INV-2026-0010');
    assert.equal(numbers[11], 'INV-2026-0012');
  });

  it('do not change invoice ids', () => {
    const app = createTestApp();
    const a = issue(app);
    moveTo(app, '2027-03-01T00:00:00.000Z');
    const b = issue(app);
    assert.match(a.id, /^inv_\d+$/);
    assert.match(b.id, /^inv_\d+$/);
    assert.notEqual(a.id, b.id);
    assert.equal(b.number, 'INV-2027-0001');
  });
});
