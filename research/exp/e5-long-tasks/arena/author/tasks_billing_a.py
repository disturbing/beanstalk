from lib import Task

CL_FIXED = "- Session cleanup runs when a user logs out.\n"
CL_ADDED = "- `GET /inventory/low-stock` for admins.\n"
CL_CHANGED = "- Product search ignores letter case.\n"

# ---------------------------------------------------------------------------
t = Task('quebec-tax', 'Customers in Quebec are charged the wrong sales tax', 'bug', 1, """
A customer in Montreal wrote to support: the sales tax on her order was lower than the amount the tax authority told her to expect.

Looking at a few Quebec orders, we charge 14% in total. The combined federal and provincial sales tax in Quebec is 14.975% (5% federal plus 9.975% provincial). Please make Quebec orders use the correct combined rate, for standard and reduced-rate goods alike. Every other province keeps its current rate.
""")
t.rep('src/billing/tax.ts', "    QC: 0.14,\n", "    QC: 0.14975,\n")
t.ins_after('CHANGELOG.md', CL_FIXED, "- Quebec orders are charged the full 14.975% sales tax.\n")
t.test('src/billing/quebec-tax.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CA_ADDRESS, createTestApp, ON_ADDRESS, placeOrder } from '../lib/testing.ts';
import { taxRateFor } from './tax.ts';

describe('Quebec sales tax', () => {
  it('uses the combined 14.975% rate, halved for reduced goods', () => {
    assert.equal(taxRateFor(CA_ADDRESS, 'standard', 0.07), 0.14975);
    assert.equal(taxRateFor(CA_ADDRESS, 'reduced', 0.07), 0.14975 / 2);
    assert.equal(taxRateFor(CA_ADDRESS, 'exempt', 0.07), 0);
  });

  it('charges that rate on a Quebec order', () => {
    const { order } = placeOrder(createTestApp(), { price: 20000 });
    assert.equal(order.tax, 2995);
    assert.equal(order.shippingAddress.region, 'QC');
  });

  it('leaves Ontario alone', () => {
    const { order } = placeOrder(createTestApp(), { price: 20000, address: ON_ADDRESS });
    assert.equal(order.tax, 2600);
  });
});
""")

t.couples('tax-breakdown', 'textual', "Both edit the Quebec row of the tax rate table in billing/tax.ts (a rate correction versus restructuring the table into federal/regional parts).")

# ---------------------------------------------------------------------------
t = Task('tax-breakdown', 'Invoices should show federal and regional tax separately', 'feature', 2, """
Canadian customers (and our accountant) want to see the federal and the regional part of the sales tax on an invoice, not one lump sum.

Add a `taxBreakdown` object with `federal` and `regional` amounts (in cents) to every invoice. The two parts must always add up to the invoice's `tax`. For a harmonised provincial tax such as Ontario's 13% HST, the federal part is 5% and the regional part is 8%. In the US, and for any region or country without a specific entry, everything counts as regional. Exempt goods have no tax in either part, and reduced-rate goods get half of each part.

In billing/tax.ts, expose the split as `taxComponentsFor(address, taxClass, fallback)`, returning `{ federal, regional }` as fractions (Ontario gives `{ federal: 0.05, regional: 0.08 }`); `taxRateFor` keeps returning the combined rate.
""")
t.rep('src/billing/tax.ts', """/** Combined sales tax by country, then by region (province or state). */
const RATES: Record<string, Record<string, number>> = {
  CA: {
    AB: 0.05,
    BC: 0.12,
    MB: 0.12,
    NB: 0.15,
    NL: 0.15,
    NS: 0.15,
    NT: 0.05,
    NU: 0.05,
    ON: 0.13,
    PE: 0.15,
    QC: 0.14,
    SK: 0.11,
    YT: 0.05,
  },
  US: {
    CA: 0.0725,
    FL: 0.06,
    NY: 0.04,
    OR: 0,
    TX: 0.0625,
    WA: 0.065,
  },
};
""", """export interface TaxComponents {
  federal: number;
  regional: number;
}

/** Sales tax by country, then by region (province or state), split into federal and regional parts. */
const RATES: Record<string, Record<string, TaxComponents>> = {
  CA: {
    AB: { federal: 0.05, regional: 0 },
    BC: { federal: 0.05, regional: 0.07 },
    MB: { federal: 0.05, regional: 0.07 },
    NB: { federal: 0.05, regional: 0.1 },
    NL: { federal: 0.05, regional: 0.1 },
    NS: { federal: 0.05, regional: 0.1 },
    NT: { federal: 0.05, regional: 0 },
    NU: { federal: 0.05, regional: 0 },
    ON: { federal: 0.05, regional: 0.08 },
    PE: { federal: 0.05, regional: 0.1 },
    QC: { federal: 0.05, regional: 0.09 },
    SK: { federal: 0.05, regional: 0.06 },
    YT: { federal: 0.05, regional: 0 },
  },
  US: {
    CA: { federal: 0, regional: 0.0725 },
    FL: { federal: 0, regional: 0.06 },
    NY: { federal: 0, regional: 0.04 },
    OR: { federal: 0, regional: 0 },
    TX: { federal: 0, regional: 0.0625 },
    WA: { federal: 0, regional: 0.065 },
  },
};

const NO_TAX: TaxComponents = { federal: 0, regional: 0 };
""")
t.rep('src/billing/tax.ts', """/**
 * The tax rate (a fraction, 0.13 = 13%) that applies to goods of `taxClass`
 * shipped to `address`. Unknown regions fall back to `fallback`.
 */
export function taxRateFor(address: Address, taxClass: TaxClass, fallback: number): number {
  if (taxClass === 'exempt') return 0;
  const country = address.country.toUpperCase();
  const region = address.region.toUpperCase();
  const full = RATES[country]?.[region] ?? fallback;
  return taxClass === 'reduced' ? full * REDUCED_SHARE : full;
}
""", """/**
 * The federal and regional tax rates (fractions, 0.05 = 5%) that apply to goods of
 * `taxClass` shipped to `address`. Unknown regions fall back to `fallback`, all regional.
 */
export function taxComponentsFor(address: Address, taxClass: TaxClass, fallback: number): TaxComponents {
  if (taxClass === 'exempt') return NO_TAX;
  const country = address.country.toUpperCase();
  const region = address.region.toUpperCase();
  const full = RATES[country]?.[region] ?? { federal: 0, regional: fallback };
  const share = taxClass === 'reduced' ? REDUCED_SHARE : 1;
  return { federal: full.federal * share, regional: full.regional * share };
}

/** The combined rate (a fraction, 0.13 = 13%). */
export function taxRateFor(address: Address, taxClass: TaxClass, fallback: number): number {
  const { federal, regional } = taxComponentsFor(address, taxClass, fallback);
  // Round away floating point noise such as 0.05 + 0.07.
  return Math.round((federal + regional) * 1e6) / 1e6;
}
""")
t.rep('src/billing/invoice.ts', "import { taxRateFor } from './tax.ts';", "import { taxComponentsFor, taxRateFor } from './tax.ts';")
t.rep('src/billing/invoice.ts', "  const tax = sumCents(lines.map((line) => line.tax));\n", """  const tax = sumCents(lines.map((line) => line.tax));
  const federal = sumCents(
    input.items.map((item, i) => {
      const { federal: rate } = taxComponentsFor(input.address, item.taxClass, ctx.config.fallbackTaxRate);
      return applyRate(nets[i] - lineDiscounts[i], rate);
    }),
  );
""")
t.rep('src/billing/invoice.ts', "    couponCode: coupon?.id ?? null,\n    tax,\n", "    couponCode: coupon?.id ?? null,\n    tax,\n    taxBreakdown: { federal, regional: tax - federal },\n")
t.rep('src/types.ts', "  couponCode: string | null;\n  tax: Cents;\n", "  couponCode: string | null;\n  tax: Cents;\n  /** `federal + regional` always equals `tax`. */\n  taxBreakdown: { federal: Cents; regional: Cents };\n")
t.ins_after('CHANGELOG.md', CL_ADDED, "- Invoices itemise federal and regional tax (`taxBreakdown`).\n")
t.test('src/billing/tax-breakdown.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, ON_ADDRESS, placeOrder, US_ADDRESS } from '../lib/testing.ts';
import { buildInvoice } from './invoice.ts';
import { taxComponentsFor, taxRateFor } from './tax.ts';

describe('tax breakdown', () => {
  it('splits Ontario HST into 5% federal and 8% regional', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { price: 10000, address: ON_ADDRESS });
    const invoice = app.ctx.store.invoices.require(order.invoiceId!);
    assert.deepEqual(invoice.taxBreakdown, { federal: 500, regional: 800 });
    assert.equal(invoice.tax, 1300);
  });

  it('counts all US state tax as regional', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { price: 10000, address: US_ADDRESS });
    const invoice = app.ctx.store.invoices.require(order.invoiceId!);
    assert.deepEqual(invoice.taxBreakdown, { federal: 0, regional: 650 });
  });

  it('has no tax in either part for exempt goods', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { price: 10000, address: ON_ADDRESS, taxClass: 'exempt' });
    assert.deepEqual(app.ctx.store.invoices.require(order.invoiceId!).taxBreakdown, { federal: 0, regional: 0 });
  });

  it('always adds up to the invoice tax, even with awkward amounts', () => {
    const app = createTestApp();
    const item = (unitPrice: number) => ({ productId: 'p', description: 'x', quantity: 1, unitPrice, taxClass: 'standard' as const });
    const invoice = buildInvoice(app.ctx, { orderId: 'o', userId: 'u', address: ON_ADDRESS, items: [item(333), item(333), item(334)] });
    assert.equal(invoice.taxBreakdown.federal + invoice.taxBreakdown.regional, invoice.tax);
    assert.ok(invoice.taxBreakdown.federal > 0 && invoice.taxBreakdown.regional > 0);
  });

  it('keeps the combined rate and exposes the components', () => {
    assert.equal(taxRateFor(ON_ADDRESS, 'standard', 0.07), 0.13);
    assert.deepEqual(taxComponentsFor(ON_ADDRESS, 'standard', 0.07), { federal: 0.05, regional: 0.08 });
    assert.deepEqual(taxComponentsFor({ ...ON_ADDRESS, country: 'JP' }, 'standard', 0.1), { federal: 0, regional: 0.1 });
  });
});
""")
t.couples('quebec-tax', 'textual', "Both edit the Quebec row of the tax rate table in billing/tax.ts (a rate correction versus restructuring the table into federal/regional parts).")

# ---------------------------------------------------------------------------
t = Task('coupon-expiry', 'Expired coupons are still accepted at checkout', 'bug', 1, """
Coupons carry an optional expiry timestamp (`expiresAt`), but checkout never looks at it: a customer applied a coupon that expired weeks ago and still got the discount.

Reject a coupon with a 400 and the message "coupon has expired" once the current time has reached its expiry time. Coupons without an expiry, and coupons that expire in the future, keep working.
""")
t.ins_after('src/billing/service.ts', "  if (couponCode && !coupon) throw badRequest('unknown coupon code');\n", """  if (coupon?.expiresAt && new Date(coupon.expiresAt).getTime() <= ctx.clock.now().getTime()) {
    throw badRequest('coupon has expired');
  }
""")
t.test('src/billing/coupon-expiry.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addCoupon, createTestApp, errorMessage, tryCheckout } from '../lib/testing.ts';

describe('coupon expiry', () => {
  it('rejects a coupon whose expiry has passed', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'OLDIE', expiresAt: '2026-09-01T00:00:00.000Z' });
    const { res } = tryCheckout(app, { couponCode: 'OLDIE' });
    assert.equal(res.status, 400);
    assert.equal(errorMessage(res), 'coupon has expired');
    assert.equal(app.ctx.store.coupons.require('OLDIE').redemptions, 0);
  });

  it('rejects it exactly at the expiry time', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'NOW', expiresAt: '2026-09-15T12:00:00.000Z' });
    assert.equal(tryCheckout(app, { couponCode: 'NOW' }).res.status, 400);
  });

  it('accepts coupons that expire later or never', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'SOON', expiresAt: '2026-09-15T12:00:01.000Z' });
    assert.equal(tryCheckout(app, { couponCode: 'SOON' }).res.status, 201);
    assert.equal(tryCheckout(app, { email: 'b@example.com', couponCode: 'WELCOME10' }).res.status, 201);
  });
});
""")
t.couples('coupon-redemption-limit', 'textual', "Both add a coupon check immediately after the unknown-coupon check in issueInvoice (billing/service.ts).")

# ---------------------------------------------------------------------------
t = Task('coupon-redemption-limit', 'Limit how many times a coupon can be redeemed', 'feature', 1, """
Marketing wants to run limited promotions ("the first 100 orders get 15% off"). Coupons already have a `maxRedemptions` limit and a `redemptions` counter that goes up with every order, but nothing enforces the limit.

Once a coupon has been redeemed `maxRedemptions` times, further checkouts using it must fail with a 409 and the message "coupon has been fully redeemed". Coupons without a limit are unaffected.
""")
t.ins_after('src/billing/service.ts', "  if (couponCode && !coupon) throw badRequest('unknown coupon code');\n", """  if (coupon && coupon.maxRedemptions !== null && coupon.redemptions >= coupon.maxRedemptions) {
    throw conflict('coupon has been fully redeemed');
  }
""")
t.test('src/billing/coupon-limits.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addCoupon, createTestApp, errorMessage, tryCheckout } from '../lib/testing.ts';

describe('coupon redemption limits', () => {
  it('stops accepting a coupon once its limit is reached', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'FIRST2', maxRedemptions: 2 });
    assert.equal(tryCheckout(app, { email: 'a@example.com', couponCode: 'FIRST2' }).res.status, 201);
    assert.equal(tryCheckout(app, { email: 'b@example.com', couponCode: 'FIRST2' }).res.status, 201);
    const third = tryCheckout(app, { email: 'c@example.com', couponCode: 'FIRST2' }).res;
    assert.equal(third.status, 409);
    assert.equal(errorMessage(third), 'coupon has been fully redeemed');
    assert.equal(app.ctx.store.coupons.require('FIRST2').redemptions, 2);
  });

  it('does not limit coupons without a maximum', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'FOREVER', redemptions: 5000 });
    assert.equal(tryCheckout(app, { couponCode: 'FOREVER' }).res.status, 201);
  });
});
""")
t.couples('coupon-expiry', 'textual', "Both add a coupon check immediately after the unknown-coupon check in issueInvoice (billing/service.ts).")

# ---------------------------------------------------------------------------
t = Task('coupon-cap', 'Fixed-amount coupons can push an order total below zero', 'bug', 1, """
A $50 fixed-amount coupon applied to a $30 cart produced an invoice with a negative taxable amount and a negative total.

A coupon must never take off more than the cart subtotal: cap the discount at the subtotal. The invoice total must never go negative, and no tax is charged on a fully discounted order.
""")
t.rep('src/billing/discounts.ts', """  return coupon.kind === 'percent' ? percentOf(subtotal, coupon.value) : coupon.value;
""", """  const discount = coupon.kind === 'percent' ? percentOf(subtotal, coupon.value) : coupon.value;
  return Math.min(discount, subtotal);
""")
t.test('src/billing/coupon-cap.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addCoupon, createTestApp, placeOrder } from '../lib/testing.ts';
import { couponDiscount } from './discounts.ts';

describe('coupon cap', () => {
  const fifty = { id: 'FIFTY', kind: 'fixed' as const, value: 5000, minSubtotal: 0, expiresAt: null, maxRedemptions: null, redemptions: 0 };

  it('never discounts more than the subtotal', () => {
    assert.equal(couponDiscount(fifty, 3000), 3000);
    assert.equal(couponDiscount(fifty, 8000), 5000);
    assert.equal(couponDiscount({ ...fifty, kind: 'percent', value: 100 }, 3000), 3000);
  });

  it('produces a zero invoice instead of a negative one', () => {
    const app = createTestApp();
    addCoupon(app.ctx, fifty);
    const { order } = placeOrder(app, { price: 3000, couponCode: 'FIFTY' });
    const invoice = app.ctx.store.invoices.require(order.invoiceId!);
    assert.deepEqual([invoice.discount, invoice.tax, invoice.total], [3000, 0, 0]);
    assert.equal(invoice.lines[0].discount, 3000);
  });
});
""")

# ---------------------------------------------------------------------------
t = Task('discount-split', 'Line discounts do not add up to the order discount', 'bug', 1, """
On a three-line order with a $1.00 coupon, the per-line discounts on the invoice add up to 99 cents even though the invoice says the order discount is $1.00. A cent goes missing, and the tax is then calculated on slightly too much.

Split the cart-level discount across the lines in proportion to their value so the shares always add up to the full discount exactly. Distribute the leftover cents fairly rather than dropping them.
""")
t.rep('src/billing/discounts.ts', "import { formatMoney, percentOf, sumCents } from '../lib/money.ts';", "import { allocate, formatMoney, percentOf } from '../lib/money.ts';")
t.rep('src/billing/discounts.ts', """export function allocateDiscount(nets: Cents[], discount: Cents): Cents[] {
  const subtotal = sumCents(nets);
  if (subtotal === 0) return nets.map(() => 0);
  return nets.map((net) => Math.floor((discount * net) / subtotal));
}""", """export function allocateDiscount(nets: Cents[], discount: Cents): Cents[] {
  return allocate(discount, nets);
}""")
t.test('src/billing/discount-split.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addCoupon, addProduct, CA_ADDRESS, createTestApp, signUp } from '../lib/testing.ts';
import { sumCents } from '../lib/money.ts';
import type { Invoice } from '../types.ts';
import { allocateDiscount } from './discounts.ts';

describe('discount split', () => {
  it('shares always add up to the discount and stay within a cent of fair', () => {
    for (const [nets, discount] of [[[333, 333, 334], 100], [[1, 1, 1, 1, 1, 1, 1], 100], [[999, 1, 500], 77]] as const) {
      const shares = allocateDiscount([...nets], discount);
      const total = sumCents([...nets]);
      assert.equal(sumCents(shares), discount);
      shares.forEach((share, i) => assert.ok(Math.abs(share - (discount * nets[i]) / total) < 1, `share ${i} of ${nets}`));
    }
    assert.deepEqual(allocateDiscount([0, 0], 100), [0, 0]);
    assert.deepEqual(allocateDiscount([500, 500], 0), [0, 0]);
  });

  it('keeps the invoice lines consistent with the header', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'ONEBUCK', kind: 'fixed', value: 100 });
    const { token } = signUp(app.ctx, 'buyer@example.com', { address: CA_ADDRESS });
    for (const price of [333, 333, 334]) {
      const product = addProduct(app.ctx, { price });
      app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 1 } });
    }
    const order = app.call('POST', '/checkout', { token, body: { addressIndex: 0, couponCode: 'ONEBUCK' } }).body as { invoiceId: string };
    const invoice = app.ctx.store.invoices.require(order.invoiceId) as Invoice;
    assert.equal(invoice.discount, 100);
    assert.equal(sumCents(invoice.lines.map((l) => l.discount)), 100);
  });
});
""")

# ---------------------------------------------------------------------------
t = Task('coupon-max-discount', 'Cap the discount a percentage coupon can give', 'feature', 2, """
Our 30%-off launch coupon is far too generous on big baskets. Percentage coupons need an optional cap on the amount they can take off, for example "20% off, up to $25".

Add an optional `maxDiscount` (in cents) to coupons. When it is set, the discount from a percentage coupon is never more than that amount. It has no effect on fixed-amount coupons or coupons without a cap, and coupons that already exist have no cap (`null`). This changes the stored data, so add a numbered migration for it (and register it) rather than special-casing missing values in the code.
""")
t.rep('src/types.ts', "  minSubtotal: Cents;\n  expiresAt: string | null;\n", "  minSubtotal: Cents;\n  /** Upper bound for the discount of a `percent` coupon. Absent or null: no cap. */\n  maxDiscount?: Cents | null;\n  expiresAt: string | null;\n")
t.rep('src/billing/discounts.ts', """  return coupon.kind === 'percent' ? percentOf(subtotal, coupon.value) : coupon.value;
""", """  if (coupon.kind === 'fixed') return coupon.value;
  const discount = percentOf(subtotal, coupon.value);
  return coupon.maxDiscount == null ? discount : Math.min(discount, coupon.maxDiscount);
""")
t.new('src/db/migrations/0006_coupon_max_discount.ts', """
import type { Migration } from '../migrate.ts';

export const migration0006: Migration = {
  version: 6,
  name: 'coupon_max_discount',
  up(store) {
    store.coupons.addColumn('maxDiscount', null);
  },
};
""")
t.rep('src/db/migrations/index.ts', "import { migration0005 } from './0005_user_roles.ts';\n", "import { migration0005 } from './0005_user_roles.ts';\nimport { migration0006 } from './0006_coupon_max_discount.ts';\n")
t.rep('src/db/migrations/index.ts', "  migration0005,\n];", "  migration0005,\n  migration0006,\n];")
t.test('src/db/coupon-max-discount-migration.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp } from '../lib/testing.ts';
import { runMigrations } from './migrate.ts';
import { migrations } from './migrations/index.ts';
import { Store } from './store.ts';

describe('migration 0006: coupon max discount', () => {
  it('leaves seeded coupons uncapped', () => {
    const app = createTestApp();
    assert.equal(app.ctx.store.coupons.require('WELCOME10').maxDiscount, null);
    assert.ok((migrations.at(-1)?.version ?? 0) > 5, 'a new migration was added after the existing five');
  });

  it('backfills coupons that already exist', () => {
    const store = new Store();
    runMigrations(store, migrations.filter((m) => m.version <= 5));
    store.coupons.insert({ id: 'OLD', kind: 'percent', value: 5 } as never);
    runMigrations(store);
    assert.equal(store.coupons.require('OLD').maxDiscount, null);
  });
});
""")
t.test('src/billing/coupon-max-discount.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addCoupon, createTestApp, placeOrder } from '../lib/testing.ts';
import { couponDiscount } from './discounts.ts';

const percent = { id: 'P20', kind: 'percent' as const, value: 20, minSubtotal: 0, expiresAt: null, maxRedemptions: null, redemptions: 0 };

describe('coupon max discount', () => {
  it('caps percentage discounts', () => {
    const capped = { ...percent, maxDiscount: 2500 };
    assert.equal(couponDiscount(capped, 20000), 2500);
    assert.equal(couponDiscount(capped, 5000), 1000);
  });

  it('ignores the cap for fixed coupons and treats missing or null as no cap', () => {
    assert.equal(couponDiscount({ ...percent, kind: 'fixed', value: 4000, maxDiscount: 100 }, 20000), 4000);
    assert.equal(couponDiscount({ ...percent, maxDiscount: null }, 20000), 4000);
    assert.equal(couponDiscount(percent, 20000), 4000);
  });

  it('applies at checkout', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { ...percent, maxDiscount: 2500 });
    const { order } = placeOrder(app, { price: 20000, couponCode: 'P20' });
    assert.equal(order.discount, 2500);
  });
});
""")

