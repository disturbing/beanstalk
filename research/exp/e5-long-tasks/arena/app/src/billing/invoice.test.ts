import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, ON_ADDRESS } from '../lib/testing.ts';
import type { Coupon } from '../types.ts';
import { buildInvoice } from './invoice.ts';
import type { InvoiceItem } from './invoice.ts';

const item = (overrides: Partial<InvoiceItem> = {}): InvoiceItem => ({
  productId: 'prd_0001',
  description: 'Thing',
  quantity: 1,
  unitPrice: 1000,
  taxClass: 'standard',
  ...overrides,
});

function build(items: InvoiceItem[], coupon?: Coupon) {
  const app = createTestApp();
  return { app, invoice: buildInvoice(app.ctx, { orderId: 'ord_0001', userId: 'usr_0001', address: ON_ADDRESS, items, coupon }) };
}

describe('buildInvoice', () => {
  it('totals a single line with tax', () => {
    const { invoice } = build([item({ quantity: 2, unitPrice: 5000 })]);
    assert.deepEqual(
      { subtotal: invoice.subtotal, discount: invoice.discount, tax: invoice.tax, total: invoice.total },
      { subtotal: 10000, discount: 0, tax: 1300, total: 11300 },
    );
    assert.equal(invoice.status, 'open');
  });

  it('applies each line its own tax class', () => {
    const { invoice } = build([item(), item({ taxClass: 'reduced' }), item({ taxClass: 'exempt' })]);
    assert.deepEqual(invoice.lines.map((l) => l.tax), [130, 65, 0]);
    assert.equal(invoice.tax, 195);
  });

  it('takes the coupon off before tax and records its code', () => {
    const coupon: Coupon = { id: 'TAKE20', kind: 'percent', value: 20, minSubtotal: 0, expiresAt: null, maxRedemptions: null, redemptions: 0 };
    const { invoice } = build([item({ unitPrice: 5000 })], coupon);
    assert.equal(invoice.discount, 1000);
    assert.equal(invoice.lines[0].discount, 1000);
    assert.equal(invoice.tax, 520);
    assert.equal(invoice.total, 4520);
    assert.equal(invoice.couponCode, 'TAKE20');
  });

  it('is due thirty days after it is issued', () => {
    const { invoice } = build([item()]);
    assert.equal(invoice.issuedAt, '2026-09-15T12:00:00.000Z');
    assert.equal(invoice.dueAt, '2026-10-15T12:00:00.000Z');
  });
});
