import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, CA_ADDRESS, ON_ADDRESS, US_ADDRESS } from '../lib/testing.ts';
import type { Address, InvoiceLine } from '../types.ts';
import * as invoice from './invoice.ts';
import type { InvoiceItem } from './invoice.ts';

const item = (overrides: Partial<InvoiceItem> = {}): InvoiceItem => ({
  productId: 'prd_0001',
  description: 'Thing',
  quantity: 1,
  unitPrice: 1000,
  taxClass: 'standard',
  ...overrides,
});

function line(address: Address, it: InvoiceItem, discount: number): InvoiceLine {
  const app = createTestApp();
  const fn = (invoice as Record<string, unknown>).buildInvoiceLine as (
    ctx: unknown,
    address: Address,
    item: InvoiceItem,
    discount: number,
  ) => InvoiceLine;
  assert.equal(typeof fn, 'function', 'buildInvoiceLine is exported');
  return fn(app.ctx, address, it, discount);
}

describe('buildInvoiceLine', () => {
  it('returns the finished line with net, discount, rate and tax', () => {
    assert.deepEqual(line(ON_ADDRESS, item({ quantity: 2, unitPrice: 5000 }), 0), {
      productId: 'prd_0001',
      description: 'Thing',
      quantity: 2,
      unitPrice: 5000,
      net: 10000,
      discount: 0,
      taxRate: 0.13,
      tax: 1300,
    });
  });

  it('taxes only what is left after the discount', () => {
    const result = line(ON_ADDRESS, item({ quantity: 3, unitPrice: 1000 }), 500);
    assert.equal(result.net, 3000);
    assert.equal(result.discount, 500);
    assert.equal(result.tax, 325);
  });

  it('uses the destination and tax class for the rate', () => {
    assert.equal(line(CA_ADDRESS, item(), 0).taxRate, 0.14);
    assert.equal(line(US_ADDRESS, item(), 0).taxRate, 0.065);
    assert.equal(line(ON_ADDRESS, item({ taxClass: 'reduced' }), 0).taxRate, 0.065);
    const exempt = line(ON_ADDRESS, item({ taxClass: 'exempt' }), 0);
    assert.equal(exempt.taxRate, 0);
    assert.equal(exempt.tax, 0);
  });

  it('falls back to the configured rate for unknown regions', () => {
    const nowhere: Address = { ...US_ADDRESS, region: 'ZZ' };
    const result = line(nowhere, item({ unitPrice: 10000 }), 0);
    assert.equal(result.taxRate, 0.07);
    assert.equal(result.tax, 700);
  });

  it('rounds tax to whole cents', () => {
    assert.equal(line(ON_ADDRESS, item({ unitPrice: 1005 }), 0).tax, 131);
  });

  it('matches the lines buildInvoice produces', () => {
    const app = createTestApp();
    const items = [item({ unitPrice: 3333 }), item({ productId: 'prd_0002', unitPrice: 6667, taxClass: 'reduced' })];
    const built = invoice.buildInvoice(app.ctx, {
      orderId: 'ord_0001',
      userId: 'usr_0001',
      address: ON_ADDRESS,
      items,
      coupon: {
        id: 'TEN',
        kind: 'percent',
        value: 10,
        minSubtotal: 0,
        expiresAt: null,
        maxRedemptions: null,
        redemptions: 0,
      },
    });
    built.lines.forEach((l, i) => assert.deepEqual(line(ON_ADDRESS, items[i], l.discount), l));
  });
});
