import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as money from '../lib/money.ts';
import { addCoupon, createTestApp, ON_ADDRESS, US_ADDRESS } from '../lib/testing.ts';
import type { Address } from '../types.ts';
import { buildInvoice } from './invoice.ts';
import type { InvoiceItem } from './invoice.ts';

const applyRateToTotal = (amounts: number[], rate: number): number[] =>
  (money as unknown as { applyRateToTotal: (a: number[], r: number) => number[] }).applyRateToTotal(amounts, rate);

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

const item = (overrides: Partial<InvoiceItem> = {}): InvoiceItem => ({
  productId: 'prd_0001',
  description: 'Thing',
  quantity: 1,
  unitPrice: 1000,
  taxClass: 'standard',
  ...overrides,
});

function build(items: InvoiceItem[], address: Address = ON_ADDRESS, coupon?: string) {
  const app = createTestApp();
  const c = coupon ? addCoupon(app.ctx, { id: coupon }) : undefined;
  return buildInvoice(app.ctx, { orderId: 'ord_0001', userId: 'usr_0001', address, items, coupon: c });
}

describe('applyRateToTotal', () => {
  it('rounds once on the total instead of per amount', () => {
    const shares = applyRateToTotal([333, 333, 333], 0.13);
    assert.equal(shares.length, 3);
    assert.equal(sum(shares), 130); // 999 * 0.13 = 129.87; per-amount rounding would give 129
  });

  it('rounds half up', () => {
    assert.equal(sum(applyRateToTotal([1, 2], 0.5)), 2); // 1.5
    assert.equal(sum(applyRateToTotal([1], 0.5)), 1); // 0.5
  });

  it('keeps each share within a cent of its exact proportional share', () => {
    const amounts = [333, 777, 1999, 1, 0, 4521];
    const rate = 0.14;
    const shares = applyRateToTotal(amounts, rate);
    assert.equal(shares.length, amounts.length);
    assert.equal(sum(shares), Math.round(sum(amounts) * rate));
    amounts.forEach((a, i) => {
      assert.ok(Number.isInteger(shares[i]));
      assert.ok(Math.abs(shares[i] - a * rate) <= 1, `share ${i}: ${shares[i]} vs ${a * rate}`);
    });
  });

  it('handles an empty list and a zero rate', () => {
    assert.deepEqual(applyRateToTotal([], 0.13), []);
    assert.deepEqual(applyRateToTotal([100, 200], 0), [0, 0]);
  });

  it('gives a single amount its whole rounded tax', () => {
    assert.deepEqual(applyRateToTotal([1999], 0.13), [260]); // 259.87
  });
});

describe('invoice tax rounding', () => {
  it('rounds once on the taxable total of lines at the same rate', () => {
    const invoice = build([item({ unitPrice: 333 }), item({ unitPrice: 333 }), item({ unitPrice: 333 })]);
    assert.equal(invoice.tax, 130);
    assert.equal(sum(invoice.lines.map((l) => l.tax)), 130);
    for (const line of invoice.lines) assert.ok(Math.abs(line.tax - 333 * 0.13) <= 1);
  });

  it('rounds each rate independently', () => {
    const invoice = build([
      item({ unitPrice: 333 }),
      item({ unitPrice: 333 }),
      item({ unitPrice: 333 }),
      item({ unitPrice: 100, taxClass: 'reduced' }),
      item({ unitPrice: 100, taxClass: 'reduced' }),
      item({ unitPrice: 500, taxClass: 'exempt' }),
    ]);
    const taxes = invoice.lines.map((l) => l.tax);
    assert.equal(sum(taxes.slice(0, 3)), 130); // 999 at 13%
    assert.equal(sum(taxes.slice(3, 5)), 13); // 200 at 6.5%; per-line rounding would give 14
    assert.equal(taxes[5], 0);
    assert.equal(invoice.tax, 143);
  });

  it('uses the discounted amounts', () => {
    const invoice = build(
      [item({ unitPrice: 333 }), item({ unitPrice: 333 }), item({ unitPrice: 333 })],
      ON_ADDRESS,
      'SAVE10',
    );
    const taxable = sum(invoice.lines.map((l) => l.net - l.discount));
    assert.ok(invoice.discount > 0);
    assert.equal(invoice.tax, Math.round(taxable * 0.13 + 1e-9));
    assert.equal(sum(invoice.lines.map((l) => l.tax)), invoice.tax);
    assert.equal(invoice.total, invoice.subtotal - invoice.discount + invoice.tax);
  });

  it('keeps the federal/regional breakdown adding up to the tax', () => {
    const invoice = build([item({ unitPrice: 333 }), item({ unitPrice: 333 }), item({ unitPrice: 333 })]);
    const b = (invoice as unknown as { taxBreakdown: { federal: number; regional: number } }).taxBreakdown;
    assert.equal(b.federal + b.regional, 130);
  });

  it('leaves single-line invoices unchanged', () => {
    assert.equal(build([item({ unitPrice: 1999 })]).tax, 260);
    const us = build([item({ unitPrice: 10000, quantity: 2 })], US_ADDRESS);
    assert.equal(us.tax, 1300);
    assert.equal(us.lines[0].tax, 1300);
  });
});
