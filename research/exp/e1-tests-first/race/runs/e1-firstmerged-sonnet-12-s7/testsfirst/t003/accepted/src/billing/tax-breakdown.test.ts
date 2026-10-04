import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, ON_ADDRESS, placeOrder, US_ADDRESS } from '../lib/testing.ts';
import type { Invoice } from '../types.ts';
import { buildInvoice } from './invoice.ts';
import type { InvoiceItem } from './invoice.ts';
import { taxComponentsFor, taxRateFor } from './tax.ts';

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

const item = (overrides: Partial<InvoiceItem> = {}): InvoiceItem => ({
  productId: 'prd_0001',
  description: 'Thing',
  quantity: 1,
  unitPrice: 1000,
  taxClass: 'standard',
  ...overrides,
});

function build(items: InvoiceItem[], address = ON_ADDRESS) {
  const app = createTestApp();
  return buildInvoice(app.ctx, { orderId: 'ord_0001', userId: 'usr_0001', address, items });
}

const breakdown = (invoice: unknown) => (invoice as { taxBreakdown: { federal: number; regional: number } }).taxBreakdown;

describe('taxComponentsFor', () => {
  it('splits Ontario HST into 5% federal and 8% regional', () => {
    const c = taxComponentsFor(ON_ADDRESS, 'standard', 0.07);
    near(c.federal, 0.05);
    near(c.regional, 0.08);
  });

  it('halves each part for reduced goods and zeroes exempt ones', () => {
    const r = taxComponentsFor(ON_ADDRESS, 'reduced', 0.07);
    near(r.federal, 0.025);
    near(r.regional, 0.04);
    assert.deepEqual(taxComponentsFor(ON_ADDRESS, 'exempt', 0.07), { federal: 0, regional: 0 });
  });

  it('counts everything as regional in the US', () => {
    const c = taxComponentsFor(US_ADDRESS, 'standard', 0.07);
    assert.equal(c.federal, 0);
    near(c.regional, 0.065);
  });

  it('counts the fallback as regional for unknown regions and countries', () => {
    const jp = taxComponentsFor({ ...ON_ADDRESS, country: 'JP', region: 'Tokyo' }, 'standard', 0.1);
    assert.equal(jp.federal, 0);
    near(jp.regional, 0.1);
    const zz = taxComponentsFor({ ...ON_ADDRESS, region: 'ZZ' }, 'standard', 0.07);
    assert.equal(zz.federal, 0);
    near(zz.regional, 0.07);
  });

  it('adds up to taxRateFor', () => {
    for (const address of [ON_ADDRESS, US_ADDRESS, { ...ON_ADDRESS, country: 'JP', region: 'X' }]) {
      for (const cls of ['standard', 'reduced', 'exempt'] as const) {
        const c = taxComponentsFor(address, cls, 0.07);
        near(c.federal + c.regional, taxRateFor(address, cls, 0.07));
      }
    }
  });
});

describe('invoice taxBreakdown', () => {
  it('splits Ontario tax into federal and regional cents', () => {
    const invoice = build([item({ unitPrice: 10000 })]);
    assert.equal(invoice.tax, 1300);
    assert.deepEqual(breakdown(invoice), { federal: 500, regional: 800 });
  });

  it('handles tax classes per line', () => {
    const invoice = build([item(), item({ taxClass: 'reduced' }), item({ taxClass: 'exempt' })]);
    assert.equal(invoice.tax, 195);
    assert.deepEqual(breakdown(invoice), { federal: 75, regional: 120 });
  });

  it('is all regional in the US', () => {
    const invoice = build([item({ unitPrice: 10000 })], US_ADDRESS);
    assert.equal(invoice.tax, 650);
    assert.deepEqual(breakdown(invoice), { federal: 0, regional: 650 });
  });

  it('is zero for exempt goods', () => {
    const invoice = build([item({ taxClass: 'exempt' })]);
    assert.deepEqual(breakdown(invoice), { federal: 0, regional: 0 });
  });

  it('always adds up to the invoice tax, even with awkward amounts', () => {
    const invoice = build([
      item({ unitPrice: 333 }),
      item({ unitPrice: 777, quantity: 3, taxClass: 'reduced' }),
      item({ unitPrice: 1999 }),
    ]);
    const b = breakdown(invoice);
    assert.ok(Number.isInteger(b.federal) && Number.isInteger(b.regional));
    assert.equal(b.federal + b.regional, invoice.tax);
    assert.ok(Math.abs(b.federal - invoice.tax * (5 / 13)) <= 2);
  });

  it('is included on invoices served over the API', () => {
    const app = createTestApp();
    const { token, order } = placeOrder(app, { address: ON_ADDRESS, price: 2000 });
    const res = app.call('GET', `/orders/${order.id}/invoice`, { token });
    assert.equal(res.status, 200);
    const invoice = res.body as Invoice;
    assert.equal(invoice.tax, 260);
    assert.deepEqual(breakdown(invoice), { federal: 100, regional: 160 });
  });
});
