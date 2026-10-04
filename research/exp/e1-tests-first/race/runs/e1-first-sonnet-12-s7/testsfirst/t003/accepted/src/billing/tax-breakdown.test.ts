import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, CA_ADDRESS, ON_ADDRESS, US_ADDRESS } from '../lib/testing.ts';
import type { Address, Coupon } from '../types.ts';
import { buildInvoice } from './invoice.ts';
import type { InvoiceItem } from './invoice.ts';
import { taxComponentsFor, taxRateFor } from './tax.ts';

const item = (overrides: Partial<InvoiceItem> = {}): InvoiceItem => ({
  productId: 'prd_0001',
  description: 'Thing',
  quantity: 1,
  unitPrice: 1000,
  taxClass: 'standard',
  ...overrides,
});

function build(items: InvoiceItem[], address: Address = ON_ADDRESS, coupon?: Coupon) {
  const app = createTestApp();
  return buildInvoice(app.ctx, { orderId: 'ord_0001', userId: 'usr_0001', address, items, coupon });
}

function assertClose(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${actual} to be close to ${expected}`);
}

describe('taxComponentsFor', () => {
  it('splits Ontario HST into 5% federal and 8% regional', () => {
    const parts = taxComponentsFor(ON_ADDRESS, 'standard', 0.07);
    assertClose(parts.federal, 0.05);
    assertClose(parts.regional, 0.08);
  });

  it('halves each part for reduced goods and zeroes both for exempt ones', () => {
    const reduced = taxComponentsFor(ON_ADDRESS, 'reduced', 0.07);
    assertClose(reduced.federal, 0.025);
    assertClose(reduced.regional, 0.04);
    assert.deepEqual(taxComponentsFor(ON_ADDRESS, 'exempt', 0.07), { federal: 0, regional: 0 });
  });

  it('counts all US tax as regional', () => {
    assert.deepEqual(taxComponentsFor(US_ADDRESS, 'standard', 0.07), { federal: 0, regional: 0.065 });
  });

  it('counts the fallback rate as regional for unknown regions', () => {
    const tokyo = { ...CA_ADDRESS, country: 'JP', region: 'Tokyo' };
    assert.deepEqual(taxComponentsFor(tokyo, 'standard', 0.1), { federal: 0, regional: 0.1 });
  });

  it('always adds up to the combined rate', () => {
    for (const address of [ON_ADDRESS, CA_ADDRESS, US_ADDRESS, { ...CA_ADDRESS, region: 'AB' }]) {
      for (const taxClass of ['standard', 'reduced', 'exempt'] as const) {
        const { federal, regional } = taxComponentsFor(address, taxClass, 0.07);
        assertClose(federal + regional, taxRateFor(address, taxClass, 0.07));
      }
    }
  });
});

describe('invoice taxBreakdown', () => {
  it('splits Ontario tax into federal and regional cents', () => {
    const invoice = build([item({ quantity: 2, unitPrice: 5000 })]);
    assert.equal(invoice.tax, 1300);
    assert.deepEqual(invoice.taxBreakdown, { federal: 500, regional: 800 });
  });

  it('halves each part for reduced goods and has none for exempt goods', () => {
    const invoice = build([item({ taxClass: 'reduced', unitPrice: 2000 })]);
    assert.equal(invoice.tax, 130);
    assert.deepEqual(invoice.taxBreakdown, { federal: 50, regional: 80 });

    const exempt = build([item({ taxClass: 'exempt' })]);
    assert.deepEqual(exempt.taxBreakdown, { federal: 0, regional: 0 });
  });

  it('counts US tax entirely as regional', () => {
    const invoice = build([item({ unitPrice: 10000 })], US_ADDRESS);
    assert.equal(invoice.tax, 650);
    assert.deepEqual(invoice.taxBreakdown, { federal: 0, regional: 650 });
  });

  it('counts tax for an unknown country entirely as regional', () => {
    const invoice = build([item({ unitPrice: 10000 })], { ...CA_ADDRESS, country: 'JP', region: 'Tokyo' });
    assert.equal(invoice.taxBreakdown.federal, 0);
    assert.equal(invoice.taxBreakdown.regional, invoice.tax);
    assert.ok(invoice.tax > 0);
  });

  it('applies the coupon before splitting', () => {
    const coupon: Coupon = { id: 'TAKE20', kind: 'percent', value: 20, minSubtotal: 0, expiresAt: null, maxRedemptions: null, redemptions: 0 };
    const invoice = build([item({ unitPrice: 5000 })], ON_ADDRESS, coupon);
    assert.equal(invoice.tax, 520);
    assert.deepEqual(invoice.taxBreakdown, { federal: 200, regional: 320 });
  });

  it('always adds up to tax, even when cents do not divide evenly', () => {
    const items = [
      item({ unitPrice: 333 }),
      item({ unitPrice: 777, taxClass: 'reduced' }),
      item({ unitPrice: 1, quantity: 7 }),
      item({ unitPrice: 999, taxClass: 'exempt' }),
    ];
    for (const address of [ON_ADDRESS, CA_ADDRESS, US_ADDRESS]) {
      const invoice = build(items, address);
      const { federal, regional } = invoice.taxBreakdown;
      assert.ok(Number.isInteger(federal) && Number.isInteger(regional));
      assert.equal(federal + regional, invoice.tax);
    }
    // Ontario: the federal share of 13% is 5/13, give or take rounding per line.
    const ontario = build(items);
    assert.ok(Math.abs(ontario.taxBreakdown.federal - (ontario.tax * 5) / 13) <= items.length);
  });
});
