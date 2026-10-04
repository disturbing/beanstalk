import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, CA_ADDRESS, ON_ADDRESS, US_ADDRESS } from '../lib/testing.ts';
import * as invoiceModule from './invoice.ts';
import type { InvoiceItem } from './invoice.ts';

const item = (overrides: Partial<InvoiceItem> = {}): InvoiceItem => ({
  productId: 'prd_0001',
  description: 'Thing',
  quantity: 1,
  unitPrice: 1000,
  taxClass: 'standard',
  ...overrides,
});

type BuildLine = (ctx: unknown, address: unknown, item: InvoiceItem, discount: number) => Record<string, unknown>;

function buildLine(address: typeof ON_ADDRESS, it_: InvoiceItem, discount: number) {
  const fn = (invoiceModule as unknown as { buildInvoiceLine?: BuildLine }).buildInvoiceLine;
  assert.equal(typeof fn, 'function', 'invoice.ts must export buildInvoiceLine');
  const app = createTestApp();
  return fn!(app.ctx, address, it_, discount);
}

describe('buildInvoiceLine', () => {
  it('copies the item identity fields', () => {
    const line = buildLine(ON_ADDRESS, item({ productId: 'prd_0042', description: 'Widget', quantity: 3, unitPrice: 250 }), 0);
    assert.equal(line.productId, 'prd_0042');
    assert.equal(line.description, 'Widget');
    assert.equal(line.quantity, 3);
    assert.equal(line.unitPrice, 250);
  });

  it('computes net as quantity times unit price', () => {
    const line = buildLine(ON_ADDRESS, item({ quantity: 4, unitPrice: 1250 }), 0);
    assert.equal(line.net, 5000);
  });

  it('records the discount passed in as the line discount', () => {
    const line = buildLine(ON_ADDRESS, item({ unitPrice: 5000 }), 1000);
    assert.equal(line.discount, 1000);
  });

  it('taxes the net with no discount', () => {
    const line = buildLine(ON_ADDRESS, item({ quantity: 2, unitPrice: 5000 }), 0);
    assert.equal(line.taxRate, 0.13);
    assert.equal(line.tax, 1300);
  });

  it('taxes only what is left after the discount', () => {
    const line = buildLine(ON_ADDRESS, item({ unitPrice: 5000 }), 1000);
    assert.equal(line.net, 5000);
    assert.equal(line.tax, 520);
  });

  it('uses the tax class for the rate', () => {
    assert.equal(buildLine(ON_ADDRESS, item({ taxClass: 'reduced' }), 0).tax, 65);
    const exempt = buildLine(ON_ADDRESS, item({ taxClass: 'exempt' }), 0);
    assert.equal(exempt.tax, 0);
    assert.equal(exempt.taxRate, 0);
  });

  it('uses the destination address for the rate', () => {
    const rates = [ON_ADDRESS, CA_ADDRESS, US_ADDRESS].map((a) => buildLine(a, item({ unitPrice: 10000 }), 0).taxRate);
    assert.equal(rates[0], 0.13);
    assert.notEqual(rates[0], rates[1]);
    assert.notEqual(rates[1], rates[2]);
  });

  it('matches the line buildInvoice produces', () => {
    const app = createTestApp();
    const it1 = item({ quantity: 3, unitPrice: 3333 });
    const invoice = invoiceModule.buildInvoice(app.ctx, {
      orderId: 'ord_0001',
      userId: 'usr_0001',
      address: ON_ADDRESS,
      items: [it1],
    });
    assert.deepEqual(buildLine(ON_ADDRESS, it1, 0), invoice.lines[0]);
  });
});
