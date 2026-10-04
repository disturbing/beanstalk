from lib import Task

CL_ADDED = "- `GET /inventory/low-stock` for admins.\n"
CL_CHANGED = "- Product search ignores letter case.\n"
README_INVOICE_ROW = "| GET | `/invoices/:id` | user |\n"
README_ADMIN_POST_ROW = "| POST | `/invoices/:id/pay`, `/orders/:id/ship` | admin |\n"

# ---------------------------------------------------------------------------
t = Task('invoice-text', 'Customers want a plain-text copy of their invoice', 'feature', 2, """
Customers keep asking for an invoice they can paste into an expense report or an email.

Add `GET /invoices/:id/text`, with the same visibility rules as the existing invoice endpoint, that returns a plain-text rendering with the content type `text/plain; charset=utf-8`. The body has the invoice number on the first line (`Invoice <number>`), then one line per item formatted as `<quantity> x <description> - <net amount>`, then `Subtotal:`, `Discount:` (only when the invoice has a discount, shown as a negative amount), `Tax:` and `Total:` lines. Amounts use the shop's normal currency formatting.
""")
t.new('src/billing/render.ts', """
import { formatMoney } from '../lib/money.ts';
import type { Invoice } from '../types.ts';

/** A plain-text invoice, suitable for email bodies and printing. */
export function renderInvoiceText(invoice: Invoice): string {
  const money = (cents: number) => formatMoney(cents, invoice.currency);
  const lines = [`Invoice ${invoice.number}`];
  for (const line of invoice.lines) {
    lines.push(`${line.quantity} x ${line.description} - ${money(line.net)}`);
  }
  lines.push(`Subtotal: ${money(invoice.subtotal)}`);
  if (invoice.discount > 0) lines.push(`Discount: -${money(invoice.discount)}`);
  lines.push(`Tax: ${money(invoice.tax)}`, `Total: ${money(invoice.total)}`);
  return lines.join('\\n');
}
""")
t.rep('src/billing/handlers.ts', "import { ok } from '../router.ts';", "import { json, ok } from '../router.ts';")
t.rep('src/billing/handlers.ts', "import { getInvoice as loadInvoice,", "import { renderInvoiceText } from './render.ts';\nimport { getInvoice as loadInvoice,")
t.append('src/billing/handlers.ts', """
export const invoiceText: Handler = (req, ctx) =>
  json(200, renderInvoiceText(visibleTo(req.user!, loadInvoice(ctx, req.params.id))), {
    'content-type': 'text/plain; charset=utf-8',
  });
""")
t.rep('src/routes.ts', "  router.add('GET', '/invoices/:id', 'user', billing.getInvoice);\n", "  router.add('GET', '/invoices/:id', 'user', billing.getInvoice);\n  router.add('GET', '/invoices/:id/text', 'user', billing.invoiceText);\n")
t.rep('README.md', README_INVOICE_ROW, "| GET | `/invoices/:id`, `/invoices/:id/text` | user |\n")
t.ins_after('CHANGELOG.md', CL_ADDED, "- `GET /invoices/:id/text` returns a plain-text invoice.\n")
t.test('src/billing/invoice-text.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, placeOrder, signUp, US_ADDRESS } from '../lib/testing.ts';

describe('plain-text invoices', () => {
  it('renders items, subtotal, tax and total', () => {
    const app = createTestApp();
    const { order, token, product } = placeOrder(app, { price: 100000, address: US_ADDRESS });
    const invoice = app.ctx.store.invoices.require(order.invoiceId!);
    const res = app.call('GET', `/invoices/${invoice.id}/text`, { token });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/plain; charset=utf-8');
    assert.equal(
      res.body,
      [`Invoice ${invoice.number}`, `1 x ${product.name} - $1000.00`, 'Subtotal: $1000.00', 'Tax: $65.00', 'Total: $1065.00'].join('\\n'),
    );
  });

  it('shows the discount as a negative amount', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app, { price: 5000, address: US_ADDRESS, couponCode: 'WELCOME10' });
    const text = app.call('GET', `/invoices/${order.invoiceId}/text`, { token }).body as string;
    assert.match(text, /^Discount: -\\$5\\.00$/m);
    assert.match(text, /^Total: \\$47\\.93$/m);
  });

  it('is only visible to the owner and admins', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app);
    const stranger = signUp(app.ctx, 'stranger@example.com');
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    const path = `/invoices/${order.invoiceId}/text`;
    assert.equal(app.call('GET', path).status, 401);
    assert.equal(app.call('GET', path, { token: stranger.token }).status, 404);
    assert.equal(app.call('GET', path, { token: admin.token }).status, 200);
    assert.equal(app.call('GET', path, { token }).status, 200);
  });
});
""")
t.couples('money-grouping', 'semantic', "invoice-text's test asserts amounts printed without digit grouping ($1000.00); money-grouping changes formatMoney to print $1,000.00. Merges cleanly, the text test then fails.")

# ---------------------------------------------------------------------------
t = Task('payment-terms', 'Make the invoice payment terms configurable', 'chore', 1, """
Invoices are always due 30 days after they are issued, and the number is hard-coded in the billing code. Enterprise customers negotiate their own terms, so make it a setting.

Add `paymentTermsDays` to the shop configuration in src/config.ts (default 30, overridable with the `PAYMENT_TERMS_DAYS` environment variable) and use it when working out an invoice's due date.
""")
t.rep('src/config.ts', "  pageSize: number;\n}", "  pageSize: number;\n  /** Days between an invoice being issued and falling due. */\n  paymentTermsDays: number;\n}")
t.rep('src/config.ts', "  pageSize: 20,\n};", "  pageSize: 20,\n  paymentTermsDays: 30,\n};")
t.rep('src/config.ts', "    lowStockThreshold: intFrom(env.LOW_STOCK_THRESHOLD, defaultConfig.lowStockThreshold),\n", "    lowStockThreshold: intFrom(env.LOW_STOCK_THRESHOLD, defaultConfig.lowStockThreshold),\n    paymentTermsDays: intFrom(env.PAYMENT_TERMS_DAYS, defaultConfig.paymentTermsDays),\n")
t.rep('src/billing/invoice.ts', "issuedAt.getTime() + 30 * DAY_MS", "issuedAt.getTime() + ctx.config.paymentTermsDays * DAY_MS")
t.ins_after('README.md', '| `LOW_STOCK_THRESHOLD` | `5` | Available quantity at or below which a product counts as low on stock |\n', "| `PAYMENT_TERMS_DAYS` | `30` | Days between an invoice being issued and falling due |\n")
t.test('src/billing/payment-terms.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultConfig, loadConfig } from '../config.ts';
import { createTestApp, ON_ADDRESS } from '../lib/testing.ts';
import { buildInvoice } from './invoice.ts';

const item = { productId: 'p', description: 'x', quantity: 1, unitPrice: 1000, taxClass: 'standard' as const };

describe('payment terms', () => {
  it('defaults to 30 days and can be overridden from the environment', () => {
    assert.equal(defaultConfig.paymentTermsDays, 30);
    assert.equal(loadConfig({}).paymentTermsDays, 30);
    assert.equal(loadConfig({ PAYMENT_TERMS_DAYS: '14' }).paymentTermsDays, 14);
    assert.throws(() => loadConfig({ PAYMENT_TERMS_DAYS: 'soon' }), /invalid integer/);
  });

  it('sets the due date from the configured terms', () => {
    const app = createTestApp();
    const issue = () => buildInvoice(app.ctx, { orderId: 'o', userId: 'u', address: ON_ADDRESS, items: [item] });
    assert.equal(issue().dueAt, '2026-10-15T12:00:00.000Z');
    app.ctx.config.paymentTermsDays = 14;
    assert.equal(issue().dueAt, '2026-09-29T12:00:00.000Z');
  });
});
""")

# ---------------------------------------------------------------------------
t = Task('invoice-year-numbers', 'Invoice numbers should restart every year', 'feature', 2, """
Our accountants want invoice numbers in the form `INV-<year>-<sequence>`, with the sequence starting again at 0001 every January 1st. For example INV-2026-0001 and INV-2026-0002, followed by INV-2027-0001 in the new year. The year is the year the invoice is issued, in UTC. Invoice ids are unaffected.
""")
t.rep('src/billing/service.ts', """  const id = ctx.store.nextId('inv');
  const invoice = ctx.store.invoices.insert({ ...draft, id, number: `INV-${id.slice(4)}` });
""", """  const id = ctx.store.nextId('inv');
  const year = ctx.clock.now().getUTCFullYear();
  const sequence = ctx.store.nextId(`inv${year}`).split('_')[1];
  const invoice = ctx.store.invoices.insert({ ...draft, id, number: `INV-${year}-${sequence}` });
""")
t.test('src/billing/invoice-numbers.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, placeOrder } from '../lib/testing.ts';

describe('invoice numbers', () => {
  it('count up within a year and restart on January 1st', () => {
    const app = createTestApp();
    const numberOf = (email: string) => {
      const { order } = placeOrder(app, { email });
      return app.ctx.store.invoices.require(order.invoiceId!).number;
    };
    assert.equal(numberOf('a@example.com'), 'INV-2026-0001');
    assert.equal(numberOf('b@example.com'), 'INV-2026-0002');
    app.clock.advance(Date.parse('2027-01-01T00:00:00Z') - app.clock.now().getTime());
    assert.equal(numberOf('c@example.com'), 'INV-2027-0001');
    assert.equal(numberOf('d@example.com'), 'INV-2027-0002');
  });

  it('keeps invoice ids sequential across years', () => {
    const app = createTestApp();
    const first = placeOrder(app, { email: 'a@example.com' }).order.invoiceId;
    app.clock.advance(Date.parse('2027-03-01T00:00:00Z') - app.clock.now().getTime());
    const second = placeOrder(app, { email: 'b@example.com' }).order.invoiceId;
    assert.deepEqual([first, second], ['inv_0001', 'inv_0002']);
  });
});
""")

# ---------------------------------------------------------------------------
t = Task('line-refunds', 'Support refunding a single invoice line', 'feature', 2, """
Support staff can currently only void a whole invoice. Customers often return one item from a multi-item order, and we need to refund just that line.

Add `POST /invoices/:id/refunds` (admin only) taking `{ "productId": "..." }`. It refunds the whole line for that product: the refund amount is the line's net amount, minus the line's share of the order discount, plus the tax charged on that line (so three identical lines refund identical amounts). Respond 201 with `{ productId, amount, createdAt }` and keep the refund on the invoice in a `refunds` list. Only paid invoices can be refunded (409 otherwise), a line can only be refunded once (409), and an unknown product is a 404.
""")
t.rep('src/types.ts', "export type InvoiceStatus = 'open' | 'paid' | 'void';\n", """export type InvoiceStatus = 'open' | 'paid' | 'void';

export interface Refund {
  productId: string;
  amount: Cents;
  createdAt: string;
}
""")
t.rep('src/types.ts', "  dueAt: string;\n  paidAt: string | null;\n}", "  dueAt: string;\n  paidAt: string | null;\n  refunds?: Refund[];\n}")
t.new('src/billing/refunds.ts', """
import { conflict, notFound } from '../lib/errors.ts';
import type { AppContext, Cents, InvoiceLine, Refund } from '../types.ts';
import { getInvoice } from './service.ts';

/** What a customer gets back for one line: its net, less its share of the discount, plus its tax. */
export function lineRefundAmount(line: InvoiceLine): Cents {
  return line.net - line.discount + line.tax;
}

/** Refund the whole line for `productId` on a paid invoice. */
export function refundLine(ctx: AppContext, invoiceId: string, productId: string): Refund {
  const invoice = getInvoice(ctx, invoiceId);
  if (invoice.status !== 'paid') {
    throw conflict(`invoice ${invoice.number} is ${invoice.status} and cannot be refunded`);
  }
  const line = invoice.lines.find((l) => l.productId === productId);
  if (!line) throw notFound('invoice line');
  const refunds = invoice.refunds ?? [];
  if (refunds.some((r) => r.productId === productId)) throw conflict('that line has already been refunded');
  const refund: Refund = {
    productId,
    amount: lineRefundAmount(line),
    createdAt: ctx.clock.now().toISOString(),
  };
  ctx.store.invoices.update(invoiceId, { refunds: [...refunds, refund] });
  return refund;
}
""")
t.rep('src/billing/handlers.ts', "import { notFound } from '../lib/errors.ts';\nimport { ok } from '../router.ts';", "import { notFound } from '../lib/errors.ts';\nimport { asBody, requireString } from '../lib/validate.ts';\nimport { created, ok } from '../router.ts';")
t.rep('src/billing/handlers.ts', "import { getInvoice as loadInvoice,", "import { refundLine } from './refunds.ts';\nimport { getInvoice as loadInvoice,")
t.append('src/billing/handlers.ts', """
export const refundInvoiceLine: Handler = (req, ctx) =>
  created(refundLine(ctx, req.params.id, requireString(asBody(req.body), 'productId')));
""")
t.rep('src/routes.ts', "  router.add('POST', '/invoices/:id/pay', 'admin', billing.payInvoice);\n", "  router.add('POST', '/invoices/:id/pay', 'admin', billing.payInvoice);\n  router.add('POST', '/invoices/:id/refunds', 'admin', billing.refundInvoiceLine);\n")
t.rep('README.md', README_ADMIN_POST_ROW, "| POST | `/invoices/:id/pay`, `/invoices/:id/refunds`, `/orders/:id/ship` | admin |\n")
t.ins_after('CHANGELOG.md', CL_ADDED, "- Admins can refund a single invoice line (`POST /invoices/:id/refunds`).\n")
t.test('src/billing/line-refunds.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp, ON_ADDRESS, signUp } from '../lib/testing.ts';
import type { Invoice, Order } from '../types.ts';
import { markPaid } from './service.ts';

function threeLineOrder() {
  const app = createTestApp();
  const customer = signUp(app.ctx, 'buyer@example.com', { address: ON_ADDRESS });
  const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
  const products = [333, 333, 333].map((price) => addProduct(app.ctx, { price }));
  for (const p of products) {
    app.call('POST', '/cart/items', { token: customer.token, body: { productId: p.id, quantity: 1 } });
  }
  const order = app.call('POST', '/checkout', { token: customer.token, body: { addressIndex: 0 } }).body as Order;
  return { app, customer, admin, products, order };
}

const refund = (t: ReturnType<typeof threeLineOrder>, productId: string, token = t.admin.token) =>
  t.app.call('POST', `/invoices/${t.order.invoiceId}/refunds`, { token, body: { productId } });

describe('line refunds', () => {
  it('refunds a line\\'s net plus the tax charged on it', () => {
    const t = threeLineOrder();
    markPaid(t.app.ctx, t.order.invoiceId!);
    const res = refund(t, t.products[0].id);
    assert.equal(res.status, 201);
    assert.equal((res.body as { productId: string }).productId, t.products[0].id);
    assert.equal((res.body as { createdAt: string }).createdAt, '2026-09-15T12:00:00.000Z');
    const invoice = t.app.ctx.store.invoices.require(t.order.invoiceId!) as Invoice;
    assert.equal(invoice.refunds?.length, 1);
    assert.equal(invoice.refunds?.[0].amount, (res.body as { amount: number }).amount);
  });

  it('refunds identical lines identically: $3.33 plus 43 cents of tax each', () => {
    const t = threeLineOrder();
    markPaid(t.app.ctx, t.order.invoiceId!);
    const amounts = t.products.map((p) => (refund(t, p.id).body as { amount: number }).amount);
    assert.deepEqual(amounts, [376, 376, 376]);
  });

  it('refunding every line returns the whole invoice total', () => {
    const t = threeLineOrder();
    markPaid(t.app.ctx, t.order.invoiceId!);
    const amounts = t.products.map((p) => (refund(t, p.id).body as { amount: number }).amount);
    assert.equal(amounts.reduce((a, b) => a + b, 0), t.app.ctx.store.invoices.require(t.order.invoiceId!).total);
  });

  it('refuses double refunds, unknown products and unpaid invoices', () => {
    const t = threeLineOrder();
    assert.equal(refund(t, t.products[0].id).status, 409, 'invoice is still open');
    markPaid(t.app.ctx, t.order.invoiceId!);
    assert.equal(refund(t, 'prd_nope').status, 404);
    assert.equal(refund(t, t.products[1].id).status, 201);
    assert.equal(refund(t, t.products[1].id).status, 409);
  });

  it('is for admins only', () => {
    const t = threeLineOrder();
    markPaid(t.app.ctx, t.order.invoiceId!);
    assert.equal(refund(t, t.products[0].id, t.customer.token).status, 403);
  });
});
""")
t.couples('tax-rounding', 'semantic', "line-refunds' test pins the refund of one line to net + that line's individually rounded tax (333 + 43); tax-rounding rounds tax once per invoice and spreads the cents (44/43/43). Merges cleanly, the refund amount then differs by a cent.")

# ---------------------------------------------------------------------------
t = Task('tax-rounding', "Tax on multi-line invoices is a cent off from the tax authority's figure", 'bug', 2, """
Our accountant compared a month of invoices against the tax authority's calculator and found that multi-line invoices are regularly a cent or two off. The authority rounds the tax once per rate on the taxable total of the invoice. We round every line separately and add the results, so the rounding errors pile up.

Work out the tax for each tax rate on the sum of the taxable amounts (after discounts) of the lines at that rate, rounding half up once, and then spread that figure back over those lines so each line keeps its own `tax` and the line taxes always add up to the invoice `tax`. Lines at different rates are rounded independently. Single-line invoices must come out the same as before.

Put the arithmetic in lib/money.ts as `applyRateToTotal(amounts, rate)`: it applies the rate to the sum of the amounts, rounds once, and returns one share per amount, each within a cent of its exact proportional share, adding up to the rounded total.
""")
t.rep('src/lib/money.ts', """export function formatMoney(""", """/**
 * Apply `rate` to a group of amounts as one sum: round once, then spread the rounded
 * result over the amounts so the parts add up to it exactly.
 */
export function applyRateToTotal(amounts: Cents[], rate: number): Cents[] {
  return allocate(applyRate(sumCents(amounts), rate), amounts);
}

export function formatMoney(""")
t.rep('src/billing/invoice.ts', "import { applyRate, sumCents } from '../lib/money.ts';", "import { applyRateToTotal, sumCents } from '../lib/money.ts';")
t.rep('src/billing/invoice.ts', """const DAY_MS = 24 * 60 * 60 * 1000;
""", """const DAY_MS = 24 * 60 * 60 * 1000;

/** Tax per line, rounded once for each distinct rate over the lines that share it. */
function taxByRate(taxable: Cents[], rates: number[]): Cents[] {
  const taxes = taxable.map(() => 0);
  for (const rate of new Set(rates)) {
    const indexes = rates.flatMap((r, i) => (r === rate ? [i] : []));
    const shares = applyRateToTotal(indexes.map((i) => taxable[i]), rate);
    indexes.forEach((lineIndex, k) => {
      taxes[lineIndex] = shares[k];
    });
  }
  return taxes;
}
""")
t.rep('src/billing/invoice.ts', """  const lines: InvoiceLine[] = input.items.map((item, i) => {
    const taxRate = taxRateFor(input.address, item.taxClass, ctx.config.fallbackTaxRate);
    return {
      productId: item.productId,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      net: nets[i],
      discount: lineDiscounts[i],
      taxRate,
      tax: applyRate(nets[i] - lineDiscounts[i], taxRate),
    };
  });
""", """  const rates = input.items.map((item) => taxRateFor(input.address, item.taxClass, ctx.config.fallbackTaxRate));
  const lineTaxes = taxByRate(nets.map((net, i) => net - lineDiscounts[i]), rates);
  const lines: InvoiceLine[] = input.items.map((item, i) => ({
    productId: item.productId,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    net: nets[i],
    discount: lineDiscounts[i],
    taxRate: rates[i],
    tax: lineTaxes[i],
  }));
""")
t.ins_after('CHANGELOG.md', CL_CHANGED, "- Invoice tax is rounded once per tax rate instead of once per line.\n")
t.test('src/billing/tax-rounding.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, ON_ADDRESS } from '../lib/testing.ts';
import { applyRateToTotal, sumCents } from '../lib/money.ts';
import type { TaxClass } from '../types.ts';
import { buildInvoice } from './invoice.ts';

const item = (unitPrice: number, taxClass: TaxClass = 'standard') => ({
  productId: 'p', description: 'x', quantity: 1, unitPrice, taxClass,
});

function invoiceFor(...items: ReturnType<typeof item>[]) {
  const app = createTestApp();
  return buildInvoice(app.ctx, { orderId: 'o', userId: 'u', address: ON_ADDRESS, items });
}

describe('tax rounding', () => {
  it('rounds once over the total and spreads the cents over the amounts', () => {
    const shares = applyRateToTotal([333, 333, 333], 0.13);
    assert.equal(sumCents(shares), 130);
    assert.deepEqual([...shares].sort(), [43, 43, 44]);
    assert.deepEqual(applyRateToTotal([0, 0], 0.13), [0, 0]);
    assert.deepEqual(applyRateToTotal([1000], 0.13), [130]);
  });

  it('charges the tax authority\\'s figure on a three-line invoice', () => {
    const invoice = invoiceFor(item(333), item(333), item(333));
    assert.equal(invoice.tax, 130);
    assert.deepEqual(invoice.lines.map((l) => l.tax).sort(), [43, 43, 44]);
    assert.equal(invoice.total, 999 + 130);
  });

  it('rounds each rate on its own', () => {
    const invoice = invoiceFor(item(333), item(333), item(333, 'reduced'));
    const taxes = invoice.lines.map((l) => l.tax);
    assert.equal(taxes[0] + taxes[1], 87, 'the two standard lines share one rounded figure');
    assert.equal(taxes[2], 22);
    assert.equal(invoice.tax, 109);
  });

  it('does not change single-line invoices', () => {
    assert.equal(invoiceFor(item(1999)).tax, 260);
    assert.equal(invoiceFor(item(10)).tax, 1);
  });
});
""")
t.couples('line-refunds', 'semantic', "tax-rounding changes the rounding contract (tax rounded once per rate and spread over lines); line-refunds' test pins a line's refund to the old per-line rounding. Merges cleanly, the refund amount then differs by a cent.")

# ---------------------------------------------------------------------------
t = Task('tax-exempt', 'Wholesale customers should not be charged sales tax', 'feature', 2, """
Our wholesale accounts hold a resale certificate and must not be charged sales tax on any of their orders.

Add a `taxExempt` flag to users: false for everyone by default, including accounts that already exist. When the customer placing an order is tax exempt, every line on their invoice gets a tax rate of 0 and no tax is charged, whatever the destination or the product's tax class. The flag is set directly in the database for now; no endpoint or UI is needed. Because it changes stored data, add a numbered migration for it (and register it) so existing accounts read `false`.
""")
t.rep('src/types.ts', "  passwordSalt: string;\n  addresses: Address[];\n", "  passwordSalt: string;\n  /** Wholesale accounts with a resale certificate are never charged sales tax. */\n  taxExempt?: boolean;\n  addresses: Address[];\n")
t.new('src/db/migrations/0006_user_tax_exempt.ts', """
import type { Migration } from '../migrate.ts';

export const migration0006: Migration = {
  version: 6,
  name: 'user_tax_exempt',
  up(store) {
    store.users.addColumn('taxExempt', false);
  },
};
""")
t.rep('src/db/migrations/index.ts', "import { migration0005 } from './0005_user_roles.ts';\n", "import { migration0005 } from './0005_user_roles.ts';\nimport { migration0006 } from './0006_user_tax_exempt.ts';\n")
t.rep('src/db/migrations/index.ts', "  migration0005,\n];", "  migration0005,\n  migration0006,\n];")
t.rep('src/billing/invoice.ts', "  coupon?: Coupon;\n}", "  coupon?: Coupon;\n  /** Skip sales tax entirely, e.g. for wholesale accounts. */\n  taxExempt?: boolean;\n}")
t.rep('src/billing/invoice.ts', "    const taxRate = taxRateFor(input.address, item.taxClass, ctx.config.fallbackTaxRate);\n    return {",
      "    const taxRate = input.taxExempt ? 0 : taxRateFor(input.address, item.taxClass, ctx.config.fallbackTaxRate);\n    return {")
t.rep('src/orders/checkout.ts', "    couponCode: input.couponCode,\n    items:", "    couponCode: input.couponCode,\n    taxExempt: user.taxExempt,\n    items:")
t.test('src/db/user-tax-exempt-migration.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, signUp } from '../lib/testing.ts';
import { runMigrations } from './migrate.ts';
import { migrations } from './migrations/index.ts';
import { Store } from './store.ts';

describe('migration 0006: user tax exempt', () => {
  it('defaults the flag to false for new users', () => {
    const app = createTestApp();
    assert.equal(signUp(app.ctx).user.taxExempt, false);
  });

  it('backfills accounts that already exist', () => {
    const store = new Store();
    runMigrations(store, migrations.filter((m) => m.version <= 5));
    store.users.insert({ id: 'usr_old', email: 'old@example.com' } as never);
    runMigrations(store);
    assert.equal(store.users.require('usr_old').taxExempt, false);
  });
});
""")
t.test('src/billing/tax-exempt.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp, ON_ADDRESS, signUp } from '../lib/testing.ts';
import type { Order } from '../types.ts';

function checkoutAs(app: ReturnType<typeof createTestApp>, email: string, taxExempt: boolean) {
  const { user, token } = signUp(app.ctx, email, { address: ON_ADDRESS });
  if (taxExempt) app.ctx.store.users.update(user.id, { taxExempt: true });
  const product = addProduct(app.ctx, { price: 10000 });
  app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 2 } });
  const order = app.call('POST', '/checkout', { token, body: { addressIndex: 0 } }).body as Order;
  return { user, order, invoice: app.ctx.store.invoices.require(order.invoiceId!) };
}

describe('tax-exempt customers', () => {
  it('charges no tax on any line of an exempt customer\\'s invoice', () => {
    const app = createTestApp();
    const { order, invoice } = checkoutAs(app, 'wholesale@example.com', true);
    assert.equal(order.tax, 0);
    assert.deepEqual(invoice.lines.map((l) => l.taxRate), [0]);
    assert.equal(invoice.total, 20000);
  });

  it('still taxes everyone else', () => {
    const app = createTestApp();
    assert.equal(checkoutAs(app, 'retail@example.com', false).order.tax, 2600);
  });
});
""")

# ---------------------------------------------------------------------------
t = Task('invoice-list', 'Customers cannot list their invoices', 'feature', 2, """
There is no way for a customer to see all their invoices; they have to know each id. Add `GET /invoices`, returning the signed-in user's invoices, newest first, as a JSON array. Support an optional `status` query parameter (`open`, `paid` or `void`) to filter them (400 for any other value), and the same `limit` / `offset` paging that the other list endpoints support.
""")
t.rep('src/billing/service.ts', "import type { AppContext, Coupon, Invoice } from '../types.ts';", "import type { AppContext, Coupon, Invoice, InvoiceStatus } from '../types.ts';")
t.ins_after('src/billing/service.ts', """  if (!invoice) throw notFound('invoice');
  return invoice;
}
""", """
/** A user's invoices, newest first, optionally only those with `status`. */
export function listInvoices(ctx: AppContext, userId: string, status?: InvoiceStatus): Invoice[] {
  return ctx.store.invoices
    .find((i) => i.userId === userId && (status === undefined || i.status === status))
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt) || b.id.localeCompare(a.id));
}
""")
t.rep('src/billing/handlers.ts', "import { notFound } from '../lib/errors.ts';", "import { badRequest, notFound } from '../lib/errors.ts';\nimport { paginate } from '../lib/pagination.ts';")
t.rep('src/billing/handlers.ts', "import type { Invoice, User } from '../types.ts';", "import type { Invoice, InvoiceStatus, User } from '../types.ts';")
t.rep('src/billing/handlers.ts', "import { getInvoice as loadInvoice, invoiceForOrder as loadInvoiceForOrder, markPaid } from './service.ts';",
      "import {\n  getInvoice as loadInvoice,\n  invoiceForOrder as loadInvoiceForOrder,\n  listInvoices,\n  markPaid,\n} from './service.ts';")
t.append('src/billing/handlers.ts', """
const STATUSES = ['open', 'paid', 'void'];

export const list: Handler = (req, ctx) => {
  const status = req.query.status;
  if (status !== undefined && !STATUSES.includes(status)) throw badRequest('status must be open, paid or void');
  const invoices = listInvoices(ctx, req.user!.id, status as InvoiceStatus | undefined);
  return ok(paginate(invoices, req.query, ctx.config.pageSize));
};
""")
t.rep('src/routes.ts', "  router.add('GET', '/invoices/:id', 'user', billing.getInvoice);\n", "  router.add('GET', '/invoices', 'user', billing.list);\n  router.add('GET', '/invoices/:id', 'user', billing.getInvoice);\n")
t.rep('README.md', README_INVOICE_ROW, "| GET | `/invoices`, `/invoices/:id` | user |\n")
t.ins_after('CHANGELOG.md', CL_ADDED, "- `GET /invoices` lists the signed-in customer's invoices.\n")
t.test('src/billing/invoice-list.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp, placeOrder } from '../lib/testing.ts';
import type { Invoice } from '../types.ts';
import { markPaid } from './service.ts';

function customerWithInvoices(count: number) {
  const app = createTestApp();
  const first = placeOrder(app);
  for (let i = 1; i < count; i++) {
    app.clock.advance(60_000);
    const product = addProduct(app.ctx);
    app.call('POST', '/cart/items', { token: first.token, body: { productId: product.id, quantity: 1 } });
    app.call('POST', '/checkout', { token: first.token, body: { addressIndex: 0 } });
  }
  return { app, token: first.token };
}

describe('invoice list', () => {
  it('returns the caller\\'s invoices as an array, newest first', () => {
    const { app, token } = customerWithInvoices(3);
    placeOrder(app, { email: 'someone-else@example.com' });
    const res = app.call('GET', '/invoices', { token });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    const invoices = res.body as Invoice[];
    assert.equal(invoices.length, 3);
    assert.deepEqual(invoices.map((i) => i.id), ['inv_0003', 'inv_0002', 'inv_0001']);
  });

  it('filters by status and rejects unknown ones', () => {
    const { app, token } = customerWithInvoices(3);
    markPaid(app.ctx, 'inv_0002');
    const paid = app.call('GET', '/invoices', { token, query: { status: 'paid' } }).body as Invoice[];
    assert.deepEqual(paid.map((i) => i.id), ['inv_0002']);
    assert.equal((app.call('GET', '/invoices', { token, query: { status: 'open' } }).body as Invoice[]).length, 2);
    assert.equal(app.call('GET', '/invoices', { token, query: { status: 'overdue' } }).status, 400);
  });

  it('pages with limit and offset', () => {
    const { app, token } = customerWithInvoices(3);
    const page = app.call('GET', '/invoices', { token, query: { limit: '2', offset: '1' } }).body as Invoice[];
    assert.deepEqual(page.map((i) => i.id), ['inv_0002', 'inv_0001']);
  });

  it('needs a signed-in user', () => {
    assert.equal(createTestApp().call('GET', '/invoices').status, 401);
  });
});
""")
t.couples('paginate-total', 'semantic', "invoice-list returns paginate()'s result as the response body (an array); paginate-total changes paginate() to return a {items, total} page. Merges cleanly, the list endpoint then returns an object instead of an array.")

# ---------------------------------------------------------------------------
t = Task('invoice-overdue', 'Finance needs a list of overdue invoices', 'feature', 2, """
Finance chases late payers by hand. Add `GET /invoices/overdue` (admin only) returning every invoice that is still `open` and whose due date has passed, the one that fell due longest ago first. Each entry is the invoice plus a `daysOverdue` field: the whole days since the due date, and at least 1 for anything that is overdue. Paid and void invoices never appear.
""")
t.append('src/billing/service.ts', """
/** Open invoices past their due date, longest overdue first. */
export function listOverdue(ctx: AppContext): Invoice[] {
  const now = ctx.clock.now().getTime();
  return ctx.store.invoices
    .find((i) => i.status === 'open' && new Date(i.dueAt).getTime() < now)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));
}
""")
t.rep('src/billing/handlers.ts', "import { getInvoice as loadInvoice, invoiceForOrder as loadInvoiceForOrder, markPaid } from './service.ts';",
      "import {\n  getInvoice as loadInvoice,\n  invoiceForOrder as loadInvoiceForOrder,\n  listOverdue,\n  markPaid,\n} from './service.ts';")
t.append('src/billing/handlers.ts', """
const DAY_MS = 24 * 60 * 60 * 1000;

export const overdue: Handler = (_req, ctx) => {
  const now = ctx.clock.now().getTime();
  return ok(
    listOverdue(ctx).map((invoice) => ({
      ...invoice,
      daysOverdue: Math.max(Math.floor((now - new Date(invoice.dueAt).getTime()) / DAY_MS), 1),
    })),
  );
};
""")
t.rep('src/routes.ts', "  router.add('GET', '/invoices/:id', 'user', billing.getInvoice);\n", "  router.add('GET', '/invoices/overdue', 'admin', billing.overdue);\n  router.add('GET', '/invoices/:id', 'user', billing.getInvoice);\n")
t.ins_after('README.md', README_ADMIN_POST_ROW, "| GET | `/invoices/overdue` | admin |\n")
t.test('src/billing/invoice-overdue.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, placeOrder, signUp } from '../lib/testing.ts';
import { markPaid, voidInvoice } from './service.ts';

const DAY = 24 * 60 * 60 * 1000;

describe('overdue invoices', () => {
  it('lists open invoices past their due date, longest overdue first', () => {
    const app = createTestApp();
    app.ctx.config.sessionTtlSeconds = 90 * 24 * 60 * 60;
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    const early = placeOrder(app, { email: 'a@example.com' }).order.invoiceId;
    app.clock.advance(5 * DAY);
    const later = placeOrder(app, { email: 'b@example.com' }).order.invoiceId;
    const paid = placeOrder(app, { email: 'c@example.com' }).order.invoiceId!;
    const voided = placeOrder(app, { email: 'd@example.com' }).order.invoiceId!;
    markPaid(app.ctx, paid);
    voidInvoice(app.ctx, voided);
    app.clock.advance(24 * DAY);
    assert.deepEqual(app.call('GET', '/invoices/overdue', { token: admin.token }).body, []);
    app.clock.advance(7 * DAY + 60_000);
    const overdue = app.call('GET', '/invoices/overdue', { token: admin.token }).body as { id: string; daysOverdue: number }[];
    assert.deepEqual(overdue.map((i) => i.id), [early, later]);
    assert.deepEqual(overdue.map((i) => i.daysOverdue), [6, 1]);
  });

  it('is for admins only and is not mistaken for an invoice id', () => {
    const app = createTestApp();
    const customer = signUp(app.ctx, 'buyer@example.com');
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    assert.equal(app.call('GET', '/invoices/overdue', { token: customer.token }).status, 403);
    assert.equal(app.call('GET', '/invoices/overdue', { token: admin.token }).status, 200);
  });
});
""")

# ---------------------------------------------------------------------------
t = Task('coupon-module-refactor', 'Move the coupon rules out of discounts.ts into their own module', 'refactor', 1, """
billing/discounts.ts mixes two concerns: the rules for coupons (is this coupon usable, and how much does it take off) and the arithmetic for splitting a discount over invoice lines.

Move `validateCoupon` and `couponDiscount` into a new billing/coupons.ts and leave `allocateDiscount` in discounts.ts. Behaviour must not change. The invoice code should import the coupon functions from the new module, and discounts.ts should keep re-exporting the two moved functions so existing imports keep working.
""")
t.new('src/billing/coupons.ts', """
import { badRequest } from '../lib/errors.ts';
import { formatMoney, percentOf } from '../lib/money.ts';
import type { Cents, Coupon, Currency } from '../types.ts';

/** Check that `coupon` may be used on a cart worth `subtotal`. Returns the coupon for chaining. */
export function validateCoupon(coupon: Coupon, subtotal: Cents, currency: Currency): Coupon {
  if (subtotal < coupon.minSubtotal) {
    throw badRequest(`coupon ${coupon.id} needs a subtotal of at least ${formatMoney(coupon.minSubtotal, currency)}`);
  }
  return coupon;
}

/** How much `coupon` takes off a cart worth `subtotal`. */
export function couponDiscount(coupon: Coupon, subtotal: Cents): Cents {
  return coupon.kind === 'percent' ? percentOf(subtotal, coupon.value) : coupon.value;
}
""")
t.rep('src/billing/discounts.ts', """import { badRequest } from '../lib/errors.ts';
import { formatMoney, percentOf, sumCents } from '../lib/money.ts';
import type { Cents, Coupon, Currency } from '../types.ts';

/** Check that `coupon` may be used on a cart worth `subtotal`. Returns the coupon for chaining. */
export function validateCoupon(coupon: Coupon, subtotal: Cents, currency: Currency): Coupon {
  if (subtotal < coupon.minSubtotal) {
    throw badRequest(`coupon ${coupon.id} needs a subtotal of at least ${formatMoney(coupon.minSubtotal, currency)}`);
  }
  return coupon;
}

/** How much `coupon` takes off a cart worth `subtotal`. */
export function couponDiscount(coupon: Coupon, subtotal: Cents): Cents {
  return coupon.kind === 'percent' ? percentOf(subtotal, coupon.value) : coupon.value;
}
""", """import { sumCents } from '../lib/money.ts';
import type { Cents } from '../types.ts';

export { couponDiscount, validateCoupon } from './coupons.ts';
""")
t.rep('src/billing/invoice.ts', "import { allocateDiscount, couponDiscount, validateCoupon } from './discounts.ts';", "import { couponDiscount, validateCoupon } from './coupons.ts';\nimport { allocateDiscount } from './discounts.ts';")
t.test('src/billing/coupons.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as discounts from './discounts.ts';
import { couponDiscount, validateCoupon } from './coupons.ts';
import type { Coupon } from '../types.ts';

const coupon: Coupon = { id: 'C', kind: 'percent', value: 25, minSubtotal: 1000, expiresAt: null, maxRedemptions: null, redemptions: 0 };

describe('coupon rules module', () => {
  it('takes a percentage or a fixed amount off', () => {
    assert.equal(couponDiscount(coupon, 2000), 500);
    assert.equal(couponDiscount({ ...coupon, kind: 'fixed', value: 300 }, 2000), 300);
  });

  it('checks the minimum subtotal', () => {
    assert.equal(validateCoupon(coupon, 1000, 'USD'), coupon);
    assert.throws(() => validateCoupon(coupon, 999, 'USD'), /at least \\$10\\.00/);
  });

  it('keeps the old import path working', () => {
    assert.equal(discounts.couponDiscount, couponDiscount);
    assert.equal(discounts.validateCoupon, validateCoupon);
    assert.deepEqual(discounts.allocateDiscount([1000, 3000], 400), [100, 300]);
  });
});
""")

# ---------------------------------------------------------------------------
t = Task('payment-receipt', 'Customers should get a receipt when their invoice is paid', 'feature', 2, """
Customers have no confirmation that we received their payment. When an invoice is marked as paid, email the customer a receipt: the subject is "Payment received for order <order number>" and the body is "We have received your payment for order <order number>. Thank you!".

It is an ordinary notification, so it also appears in the customer's notification list, with the kind `payment_received`.
""")
t.rep('src/types.ts', "export type NotificationKind = 'order_confirmed' | 'order_shipped' | 'order_cancelled';", "export type NotificationKind = 'order_confirmed' | 'order_shipped' | 'order_cancelled' | 'payment_received';")
t.rep('src/notifications/templates.ts', """        body: `Your order ${order.number} was cancelled. Any payment will be refunded.`,
      };
""", """        body: `Your order ${order.number} was cancelled. Any payment will be refunded.`,
      };
    case 'payment_received':
      return {
        subject: `Payment received for order ${order.number}`,
        body: `We have received your payment for order ${order.number}. Thank you!`,
      };
""")
t.rep('src/billing/service.ts', "import { badRequest, conflict, notFound } from '../lib/errors.ts';", "import { badRequest, conflict, notFound } from '../lib/errors.ts';\nimport { enqueueNotification } from '../notifications/queue.ts';")
t.rep('src/billing/service.ts', """  return ctx.store.invoices.update(id, { status: 'paid', paidAt: ctx.clock.now().toISOString() });
}""", """  const paid = ctx.store.invoices.update(id, { status: 'paid', paidAt: ctx.clock.now().toISOString() });
  const order = ctx.store.orders.get(invoice.orderId);
  if (order) enqueueNotification(ctx, 'payment_received', order);
  return paid;
}""")
t.test('src/billing/payment-receipt.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, placeOrder, signUp } from '../lib/testing.ts';
import type { Notification } from '../types.ts';
import { markPaid } from './service.ts';

describe('payment receipts', () => {
  it('emails the customer when an invoice is paid', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { email: 'carol@example.com' });
    const before = app.mailer.sent.length;
    markPaid(app.ctx, order.invoiceId!);
    assert.equal(app.mailer.sent.length, before + 1);
    assert.deepEqual(app.mailer.sent.at(-1), {
      to: 'carol@example.com',
      subject: `Payment received for order ${order.number}`,
      body: `We have received your payment for order ${order.number}. Thank you!`,
    });
  });

  it('is sent when an admin pays over HTTP, and only then', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app);
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    const sentBefore = app.mailer.sent.length;
    app.call('POST', `/invoices/${order.invoiceId}/pay`, { token });
    assert.equal(app.mailer.sent.length, sentBefore, 'customers cannot pay for themselves');
    app.call('POST', `/invoices/${order.invoiceId}/pay`, { token: admin.token });
    app.call('POST', `/invoices/${order.invoiceId}/pay`, { token: admin.token });
    assert.equal(app.mailer.sent.length, sentBefore + 1, 'a second attempt fails and sends nothing');
  });

  it('shows up in the notification list as payment_received', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app);
    markPaid(app.ctx, order.invoiceId!);
    const list = app.call('GET', '/notifications', { token }).body as Notification[];
    assert.ok(list.some((n) => n.kind === 'payment_received'));
  });
});
""")
t.test('src/notifications/receipt-template.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, placeOrder } from '../lib/testing.ts';
import { renderNotification } from './templates.ts';

describe('payment receipt template', () => {
  it('names the order', () => {
    const { order } = placeOrder(createTestApp());
    assert.deepEqual(renderNotification('payment_received', order, 'USD'), {
      subject: `Payment received for order ${order.number}`,
      body: `We have received your payment for order ${order.number}. Thank you!`,
    });
  });
});
""")
