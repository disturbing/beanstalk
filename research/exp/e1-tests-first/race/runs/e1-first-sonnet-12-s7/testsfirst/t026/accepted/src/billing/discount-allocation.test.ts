import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, ON_ADDRESS } from '../lib/testing.ts';
import { allocateDiscount } from './discounts.ts';
import { buildInvoice } from './invoice.ts';
import type { InvoiceItem } from './invoice.ts';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const item = (n: number, unitPrice: number): InvoiceItem => ({
  productId: `prd_000${n}`,
  description: `Thing ${n}`,
  quantity: 1,
  unitPrice,
  taxClass: 'standard',
});

/** Every share is the exact proportional share rounded down or up, and together they equal the discount. */
function assertFairSplit(nets: number[], discount: number) {
  const shares = allocateDiscount(nets, discount);
  const total = sum(nets);
  assert.equal(shares.length, nets.length);
  assert.equal(sum(shares), discount, `shares of ${discount} over ${nets} add up`);
  nets.forEach((net, i) => {
    const exact = (discount * net) / total;
    assert.ok(Number.isInteger(shares[i]), 'whole cents');
    assert.ok(shares[i] >= Math.floor(exact) && shares[i] <= Math.ceil(exact), `share ${i} is near ${exact}`);
  });
  return shares;
}

describe('allocateDiscount', () => {
  it('splits $1.00 over three equal lines without losing a cent', () => {
    const shares = assertFairSplit([1000, 1000, 1000], 100);
    assert.deepEqual([...shares].sort(), [33, 33, 34]);
  });

  it('still splits evenly divisible discounts proportionally', () => {
    assert.deepEqual(allocateDiscount([1000, 3000], 400), [100, 300]);
  });

  it('adds up exactly for uneven lines', () => {
    assertFairSplit([333, 667, 1001], 101);
    assertFairSplit([1, 1, 1, 1, 1, 1, 1], 5);
    assertFairSplit([999, 1, 500], 777);
    assertFairSplit([1234, 5678, 91011], 9999);
  });

  it('gives a zero-value line nothing', () => {
    const shares = assertFairSplit([0, 1000, 1000], 101);
    assert.equal(shares[0], 0);
  });

  it('can discount the whole cart', () => {
    assert.deepEqual(allocateDiscount([333, 333, 334], 1000), [333, 333, 334]);
  });

  it('is deterministic', () => {
    assert.deepEqual(allocateDiscount([1000, 1000, 1000], 100), allocateDiscount([1000, 1000, 1000], 100));
  });

  it('does not spread leftovers onto lines worth nothing when the cart is empty', () => {
    assert.deepEqual(allocateDiscount([0, 0], 400), [0, 0]);
  });
});

describe('buildInvoice discount allocation', () => {
  it('line discounts add up to the invoice discount for a $1.00 coupon on three lines', () => {
    const app = createTestApp();
    const draft = buildInvoice(app.ctx, {
      orderId: 'ord_0001',
      userId: 'usr_0001',
      address: ON_ADDRESS,
      items: [item(1, 1000), item(2, 1000), item(3, 1000)],
      coupon: {
        id: 'ONE',
        kind: 'fixed',
        value: 100,
        minSubtotal: 0,
        expiresAt: null,
        maxRedemptions: null,
        redemptions: 0,
      },
    });
    assert.equal(draft.discount, 100);
    assert.equal(sum(draft.lines.map((l) => l.discount)), 100);
    assert.equal(draft.subtotal - draft.discount + draft.tax, draft.total);
  });

  it('line discounts add up for a percent coupon on awkward prices', () => {
    const app = createTestApp();
    const draft = buildInvoice(app.ctx, {
      orderId: 'ord_0001',
      userId: 'usr_0001',
      address: ON_ADDRESS,
      items: [item(1, 333), item(2, 667), item(3, 1001)],
      coupon: {
        id: 'SEVEN',
        kind: 'percent',
        value: 7,
        minSubtotal: 0,
        expiresAt: null,
        maxRedemptions: null,
        redemptions: 0,
      },
    });
    assert.ok(draft.discount > 0);
    assert.equal(sum(draft.lines.map((l) => l.discount)), draft.discount);
  });
});
