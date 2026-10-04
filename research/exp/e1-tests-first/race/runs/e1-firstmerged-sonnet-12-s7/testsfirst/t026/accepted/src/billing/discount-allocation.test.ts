import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, ON_ADDRESS } from '../lib/testing.ts';
import { allocateDiscount } from './discounts.ts';
import { buildInvoice } from './invoice.ts';
import type { Coupon } from '../types.ts';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('allocateDiscount', () => {
  it('adds up to the full discount when the shares do not divide evenly', () => {
    const shares = allocateDiscount([1000, 1000, 1000], 100);
    assert.equal(sum(shares), 100);
    for (const s of shares) assert.ok(s === 33 || s === 34, `share ${s} should be 33 or 34`);
  });

  it('gives the leftover cent to the line with the largest fractional share', () => {
    assert.deepEqual(allocateDiscount([333, 333, 334], 10), [3, 3, 4]);
  });

  it('keeps proportional shares exact when they divide evenly', () => {
    assert.deepEqual(allocateDiscount([1000, 3000], 400), [100, 300]);
  });

  it('adds up exactly across many awkward splits', () => {
    const cases: [number[], number][] = [
      [[1, 1, 1], 100],
      [[999, 1], 50],
      [[1234, 5678, 91011, 1213], 4999],
      [[100, 100, 100, 100, 100, 100, 100], 101],
      [[5, 7], 11],
    ];
    for (const [nets, discount] of cases) {
      const shares = allocateDiscount(nets, discount);
      assert.equal(shares.length, nets.length);
      assert.equal(sum(shares), discount, `nets ${nets} discount ${discount}`);
      const total = sum(nets);
      shares.forEach((s, i) => {
        const exact = (discount * nets[i]) / total;
        assert.ok(s >= Math.floor(exact) && s <= Math.ceil(exact), `share ${s} too far from ${exact}`);
      });
    }
  });

  it('allocates nothing when the discount is zero', () => {
    assert.deepEqual(allocateDiscount([500, 700], 0), [0, 0]);
  });
});

describe('buildInvoice discount allocation', () => {
  it('line discounts add up to the order discount on a three-line order with a $1.00 coupon', () => {
    const app = createTestApp();
    const coupon: Coupon = {
      id: 'ONEBUCK',
      kind: 'fixed',
      value: 100,
      minSubtotal: 0,
      expiresAt: null,
      maxRedemptions: null,
      redemptions: 0,
    };
    const items = [1, 2, 3].map((n) => ({
      productId: `prd_000${n}`,
      description: `Thing ${n}`,
      quantity: 1,
      unitPrice: 1000,
      taxClass: 'standard' as const,
    }));
    const invoice = buildInvoice(app.ctx, { orderId: 'ord_0001', userId: 'usr_0001', address: ON_ADDRESS, items, coupon });
    assert.equal(invoice.discount, 100);
    assert.equal(sum(invoice.lines.map((l) => l.discount)), 100);
    assert.equal(invoice.total, invoice.subtotal - 100 + invoice.tax);
  });
});
