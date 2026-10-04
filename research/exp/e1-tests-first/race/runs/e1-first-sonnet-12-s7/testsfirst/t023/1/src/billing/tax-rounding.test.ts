import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, ON_ADDRESS } from '../lib/testing.ts';
import * as money from '../lib/money.ts';
import { buildInvoice } from './invoice.ts';
import type { InvoiceItem } from './invoice.ts';

const applyRateToTotal = (amounts: number[], rate: number): number[] => {
  const fn = (money as Record<string, unknown>).applyRateToTotal as (a: number[], r: number) => number[];
  assert.equal(typeof fn, 'function', 'applyRateToTotal is exported from lib/money.ts');
  return fn(amounts, rate);
};

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

const item = (overrides: Partial<InvoiceItem> = {}): InvoiceItem => ({
  productId: 'prd_0001',
  description: 'Thing',
  quantity: 1,
  unitPrice: 1005,
  taxClass: 'standard',
  ...overrides,
});

function invoiceFor(items: InvoiceItem[], coupon?: Parameters<typeof buildInvoice>[1]['coupon']) {
  const app = createTestApp();
  return buildInvoice(app.ctx, {
    orderId: 'ord_0001',
    userId: 'usr_0001',
    address: ON_ADDRESS,
    items,
    coupon,
  });
}

describe('applyRateToTotal', () => {
  it('shares add up to the total rounded once', () => {
    // 3 x 1005 at 13%: 391.95 -> 392 (per-amount rounding would give 393)
    const shares = applyRateToTotal([1005, 1005, 1005], 0.13);
    assert.equal(shares.length, 3);
    assert.equal(sum(shares), 392);
  });

  it('rounds half up once on the total', () => {
    assert.equal(sum(applyRateToTotal([1, 1, 1], 0.5)), 2);
    assert.deepEqual(applyRateToTotal([5], 0.5), [3]);
  });

  it('keeps each share within a cent of its exact proportional share', () => {
    const amounts = [1005, 333, 2999, 1, 4750];
    const rate = 0.13;
    const shares = applyRateToTotal(amounts, rate);
    assert.equal(shares.length, amounts.length);
    amounts.forEach((amount, i) => {
      assert.ok(Math.abs(shares[i] - amount * rate) <= 1, `share ${i} is ${shares[i]}, exact ${amount * rate}`);
    });
    assert.equal(sum(shares), Math.round(sum(amounts) * rate));
  });

  it('gives a single amount its own rounded tax', () => {
    assert.deepEqual(applyRateToTotal([1005], 0.13), [131]);
    assert.deepEqual(applyRateToTotal([0], 0.13), [0]);
  });

  it('handles zero rate, zero amounts and no amounts', () => {
    assert.deepEqual(applyRateToTotal([100, 200], 0), [0, 0]);
    assert.deepEqual(applyRateToTotal([0, 0], 0.13), [0, 0]);
    assert.deepEqual(applyRateToTotal([], 0.13), []);
  });
});

describe('invoice tax is rounded once per rate', () => {
  it('rounds the tax of same-rate lines on their combined total', () => {
    const inv = invoiceFor([
      item({ productId: 'prd_0001' }),
      item({ productId: 'prd_0002' }),
      item({ productId: 'prd_0003' }),
    ]);
    assert.equal(inv.tax, 392);
    assert.equal(sum(inv.lines.map((l) => l.tax)), inv.tax);
    for (const l of inv.lines) assert.ok(Math.abs(l.tax - 130.65) <= 1);
    assert.equal(inv.total, inv.subtotal - inv.discount + inv.tax);
  });

  it('rounds each rate independently', () => {
    const inv = invoiceFor([
      item({ productId: 'prd_0001' }),
      item({ productId: 'prd_0002' }),
      item({ productId: 'prd_0003', taxClass: 'reduced' }),
      item({ productId: 'prd_0004', taxClass: 'reduced' }),
      item({ productId: 'prd_0005', taxClass: 'exempt' }),
    ]);
    const standard = inv.lines.filter((l) => l.taxRate === 0.13);
    const reduced = inv.lines.filter((l) => l.taxRate === 0.065);
    const exempt = inv.lines.filter((l) => l.taxRate === 0);
    assert.equal(sum(standard.map((l) => l.tax)), 261); // 2010 * 0.13 = 261.3
    assert.equal(sum(reduced.map((l) => l.tax)), 131); // 2010 * 0.065 = 130.65
    assert.equal(sum(exempt.map((l) => l.tax)), 0);
    assert.equal(inv.tax, 392);
    assert.equal(sum(inv.lines.map((l) => l.tax)), inv.tax);
  });

  it('uses the taxable amount after discounts', () => {
    const inv = invoiceFor(
      [item({ productId: 'prd_0001' }), item({ productId: 'prd_0002' }), item({ productId: 'prd_0003' })],
      { id: 'TEN', kind: 'percent', value: 10, minSubtotal: 0, expiresAt: null, maxRedemptions: null, redemptions: 0 },
    );
    const taxable = sum(inv.lines.map((l) => l.net - l.discount));
    assert.equal(inv.tax, Math.round(taxable * 0.13));
    assert.equal(sum(inv.lines.map((l) => l.tax)), inv.tax);
    for (const l of inv.lines) assert.ok(Math.abs(l.tax - (l.net - l.discount) * 0.13) <= 1);
  });

  it('leaves single-line invoices unchanged', () => {
    const inv = invoiceFor([item({ quantity: 2, unitPrice: 5000 })]);
    assert.equal(inv.lines[0].tax, 1300);
    assert.equal(inv.tax, 1300);
    assert.equal(invoiceFor([item()]).tax, 131);
  });
});
