import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, placeOrder } from '../lib/testing.ts';
import type { TestApp } from '../lib/testing.ts';
import { getInvoice } from './service.ts';

const HOUR = 60 * 60 * 1000;

function setTime(app: TestApp, iso: string): void {
  app.clock.advance(new Date(iso).getTime() - app.clock.now().getTime());
}

let n = 0;
function issue(app: TestApp) {
  n += 1;
  const { order } = placeOrder(app, { email: `buyer${n}@example.com` });
  return getInvoice(app.ctx, order.invoiceId!);
}

describe('invoice numbers', () => {
  it('start at 0001 for the year of issue and count up', () => {
    const app = createTestApp();
    setTime(app, '2026-03-10T10:00:00.000Z');
    assert.deepEqual([issue(app), issue(app), issue(app)].map((i) => i.number), [
      'INV-2026-0001',
      'INV-2026-0002',
      'INV-2026-0003',
    ]);
  });

  it('restart at 0001 in the new year', () => {
    const app = createTestApp();
    setTime(app, '2026-12-30T10:00:00.000Z');
    assert.equal(issue(app).number, 'INV-2026-0001');
    assert.equal(issue(app).number, 'INV-2026-0002');
    setTime(app, '2027-01-02T10:00:00.000Z');
    assert.equal(issue(app).number, 'INV-2027-0001');
    assert.equal(issue(app).number, 'INV-2027-0002');
  });

  it('switch year at midnight UTC', () => {
    const app = createTestApp();
    setTime(app, '2026-12-31T23:59:59.000Z');
    assert.equal(issue(app).number, 'INV-2026-0001');
    app.clock.advance(1000);
    assert.equal(issue(app).number, 'INV-2027-0001');
  });

  it('use the UTC year, not a local one', () => {
    const app = createTestApp();
    setTime(app, '2026-12-31T23:30:00.000Z');
    assert.equal(issue(app).number, 'INV-2026-0001');
    setTime(app, '2027-01-01T00:30:00.000Z');
    assert.equal(issue(app).number, 'INV-2027-0001');
    app.clock.advance(HOUR);
    assert.equal(issue(app).number, 'INV-2027-0002');
  });

  it('leave invoice ids unique and unaffected by the restart', () => {
    const app = createTestApp();
    setTime(app, '2026-12-31T12:00:00.000Z');
    const a = issue(app);
    setTime(app, '2027-01-01T12:00:00.000Z');
    const b = issue(app);
    assert.notEqual(a.id, b.id);
    assert.equal(b.number, 'INV-2027-0001');
    assert.equal(getInvoice(app.ctx, b.id).number, 'INV-2027-0001');
  });
});
