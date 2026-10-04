from lib import Task

# ---------------------------------------------------------------------------
t = Task('line-tax-extract', 'Split the per-line work out of buildInvoice', 'refactor', 1, """
buildInvoice in billing/invoice.ts has grown into one long function. Pull the work for a single invoice line into an exported `buildInvoiceLine(ctx, address, item, discount)` that returns the finished `InvoiceLine`: the item's net amount (quantity times unit price), the line's share of the discount, the tax rate for the destination, and the tax on what is left after the discount. buildInvoice should build its lines with it. Behaviour must not change.
""")
t.rep('src/billing/invoice.ts', """const DAY_MS = 24 * 60 * 60 * 1000;
""", """const DAY_MS = 24 * 60 * 60 * 1000;

/** One invoice line: what the item costs, its share of the discount, and the tax on what is left. */
export function buildInvoiceLine(ctx: AppContext, address: Address, item: InvoiceItem, discount: Cents): InvoiceLine {
  const net = item.quantity * item.unitPrice;
  const taxRate = taxRateFor(address, item.taxClass, ctx.config.fallbackTaxRate);
  return {
    productId: item.productId,
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    net,
    discount,
    taxRate,
    tax: applyRate(net - discount, taxRate),
  };
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
""", """  const lines = input.items.map((item, i) => buildInvoiceLine(ctx, input.address, item, lineDiscounts[i]));
""")
t.test('src/billing/invoice-line.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, ON_ADDRESS, US_ADDRESS } from '../lib/testing.ts';
import type { InvoiceItem } from './invoice.ts';
import { buildInvoice, buildInvoiceLine } from './invoice.ts';

const item: InvoiceItem = { productId: 'prd_1', description: 'Teapot', quantity: 2, unitPrice: 5000, taxClass: 'standard' };

describe('buildInvoiceLine', () => {
  it('works out net, discount, rate and tax for one item', () => {
    const app = createTestApp();
    assert.deepEqual(buildInvoiceLine(app.ctx, ON_ADDRESS, item, 1000), {
      productId: 'prd_1',
      description: 'Teapot',
      quantity: 2,
      unitPrice: 5000,
      net: 10000,
      discount: 1000,
      taxRate: 0.13,
      tax: 1170,
    });
  });

  it('uses the tax class and the destination', () => {
    const app = createTestApp();
    assert.equal(buildInvoiceLine(app.ctx, US_ADDRESS, { ...item, taxClass: 'reduced' }, 0).taxRate, 0.0325);
    assert.equal(buildInvoiceLine(app.ctx, ON_ADDRESS, { ...item, taxClass: 'exempt' }, 0).tax, 0);
  });

  it('is what buildInvoice builds its lines from', () => {
    const app = createTestApp();
    const other: InvoiceItem = { ...item, productId: 'prd_2', quantity: 1, unitPrice: 999 };
    const invoice = buildInvoice(app.ctx, { orderId: 'o', userId: 'u', address: ON_ADDRESS, items: [item, other] });
    assert.deepEqual(invoice.lines[0], buildInvoiceLine(app.ctx, ON_ADDRESS, item, 0));
    assert.deepEqual(invoice.lines[1], buildInvoiceLine(app.ctx, ON_ADDRESS, other, 0));
  });
});
""")

# ---------------------------------------------------------------------------
t = Task('filter-products', 'Make product filtering a pure function', 'refactor', 1, """
listProducts in catalog/service.ts reads from the store and applies the filter rules in the same breath, which makes the rules awkward to reuse and to test. Extract them into an exported pure function `filterProducts(products, filter)` that takes an array of products and the same filter object and returns the products that pass, in their original order, without modifying the input. listProducts should use it (and still sort by name). Behaviour must not change.
""")
t.rep('src/catalog/service.ts', """export function listProducts(ctx: AppContext, filter: ProductFilter = {}): Product[] {
  return ctx.store.products
    .find((p) => {
      if (!filter.includeInactive && !p.active) return false;
      if (filter.category && p.category !== filter.category) return false;
      if (filter.q && !matchesQuery(p, filter.q)) return false;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}""", """/** The products that pass `filter`, in their original order. */
export function filterProducts(products: Product[], filter: ProductFilter = {}): Product[] {
  return products.filter((p) => {
    if (!filter.includeInactive && !p.active) return false;
    if (filter.category && p.category !== filter.category) return false;
    if (filter.q && !matchesQuery(p, filter.q)) return false;
    return true;
  });
}

export function listProducts(ctx: AppContext, filter: ProductFilter = {}): Product[] {
  return filterProducts(ctx.store.products.all(), filter).sort((a, b) => a.name.localeCompare(b.name));
}""")
t.test('src/catalog/filter-products.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp } from '../lib/testing.ts';
import type { Product } from '../types.ts';
import { filterProducts, listProducts } from './service.ts';

const product = (id: string, overrides: Partial<Product> = {}): Product => ({
  id, sku: `SKU-${id}`, name: `Item ${id}`, description: '', price: 1000, category: 'general',
  taxClass: 'standard', weightKg: 0.5, active: true, createdAt: '2026-09-01T00:00:00.000Z', ...overrides,
});

describe('filterProducts', () => {
  const items = [
    product('c', { category: 'tea', name: 'Green tea' }),
    product('a', { category: 'coffee', name: 'Dark roast', description: 'Strong coffee' }),
    product('b', { category: 'coffee', name: 'Decaf', active: false }),
  ];

  it('hides retired products unless asked', () => {
    assert.deepEqual(filterProducts(items).map((p) => p.id), ['c', 'a']);
    assert.deepEqual(filterProducts(items, { includeInactive: true }).map((p) => p.id), ['c', 'a', 'b']);
  });

  it('filters by category and by search words, keeping the input order', () => {
    assert.deepEqual(filterProducts(items, { category: 'coffee' }).map((p) => p.id), ['a']);
    assert.deepEqual(filterProducts(items, { q: 'STRONG coffee' }).map((p) => p.id), ['a']);
    assert.deepEqual(filterProducts(items, { category: 'tea', q: 'roast' }), []);
  });

  it('does not modify its input', () => {
    const copy = structuredClone(items);
    filterProducts(items, { category: 'tea' });
    assert.deepEqual(items, copy);
  });
});

describe('listProducts', () => {
  it('still sorts by name', () => {
    const app = createTestApp();
    addProduct(app.ctx, { name: 'Zinc' });
    addProduct(app.ctx, { name: 'Alloy' });
    assert.deepEqual(listProducts(app.ctx).map((p) => p.name), ['Alloy', 'Zinc']);
  });
});
""")

# ---------------------------------------------------------------------------
t = Task('session-expiry', 'Work out session expiry in one place', 'chore', 1, """
The session lifetime sum (`now + sessionTtlSeconds`) is written out inline in createSession in auth/sessions.ts, and we are about to need it in more places. Move it into an exported helper `sessionExpiry(ctx, from?)` in the same file that returns the ISO timestamp one session lifetime after `from` (default: now, from the context's clock), and use it in createSession. Behaviour must not change.
""")
t.rep('src/auth/sessions.ts', "export function createSession(ctx: AppContext, userId: string): Session {", """/** When a session that starts at `from` expires. */
export function sessionExpiry(ctx: AppContext, from: Date = ctx.clock.now()): string {
  return new Date(from.getTime() + ctx.config.sessionTtlSeconds * 1000).toISOString();
}

export function createSession(ctx: AppContext, userId: string): Session {""")
t.rep('src/auth/sessions.ts', "    expiresAt: new Date(now.getTime() + ctx.config.sessionTtlSeconds * 1000).toISOString(),\n", "    expiresAt: sessionExpiry(ctx, now),\n")
t.test('src/auth/session-expiry.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, signUp } from '../lib/testing.ts';
import { createSession, sessionExpiry } from './sessions.ts';

describe('sessionExpiry', () => {
  it('is one lifetime after now by default', () => {
    const app = createTestApp();
    assert.equal(sessionExpiry(app.ctx), '2026-09-15T13:00:00.000Z');
    app.clock.advance(60_000);
    assert.equal(sessionExpiry(app.ctx), '2026-09-15T13:01:00.000Z');
  });

  it('can start from any moment and follows the configured lifetime', () => {
    const app = createTestApp();
    app.ctx.config.sessionTtlSeconds = 90;
    assert.equal(sessionExpiry(app.ctx, new Date('2026-01-01T00:00:00.000Z')), '2026-01-01T00:01:30.000Z');
  });

  it('is what new sessions expire at', () => {
    const app = createTestApp();
    const { user } = signUp(app.ctx);
    app.clock.advance(5_000);
    assert.equal(createSession(app.ctx, user.id).expiresAt, sessionExpiry(app.ctx));
  });
});
""")

# ---------------------------------------------------------------------------
t = Task('notification-templates', 'Replace the notification switch with a template table', 'refactor', 1, """
renderNotification in notifications/templates.ts is a switch with one branch per kind, and every new notification kind means editing that function. Turn it into a table: export a `templates` record, keyed by notification kind, whose values are render functions taking `(order, currency)` and returning `{ subject, body }`. renderNotification should just look the kind up in it. The text produced for the existing kinds must not change.
""")
t.rep('src/notifications/templates.ts', """export function renderNotification(kind: NotificationKind, order: Order, currency: Currency): Rendered {
  switch (kind) {
    case 'order_confirmed': {
      const lines = order.lines.map(
        (line) => `${line.quantity} x ${line.name} - ${formatMoney(line.unitPrice * line.quantity, currency)}`,
      );
      return {
        subject: `Order ${order.number} confirmed`,
        body: ['Thanks for your order!', ...lines, `Total: ${formatMoney(order.total, currency)}`].join('\\n'),
      };
    }
    case 'order_shipped':
      return {
        subject: `Order ${order.number} has shipped`,
        body: `Your order ${order.number} is on its way.`,
      };
    case 'order_cancelled':
      return {
        subject: `Order ${order.number} was cancelled`,
        body: `Your order ${order.number} was cancelled. Any payment will be refunded.`,
      };
  }
}""", """type Template = (order: Order, currency: Currency) => Rendered;

/** One render function per notification kind. A new kind is a new entry here. */
export const templates: Record<NotificationKind, Template> = {
  order_confirmed(order, currency) {
    const lines = order.lines.map(
      (line) => `${line.quantity} x ${line.name} - ${formatMoney(line.unitPrice * line.quantity, currency)}`,
    );
    return {
      subject: `Order ${order.number} confirmed`,
      body: ['Thanks for your order!', ...lines, `Total: ${formatMoney(order.total, currency)}`].join('\\n'),
    };
  },
  order_shipped(order) {
    return {
      subject: `Order ${order.number} has shipped`,
      body: `Your order ${order.number} is on its way.`,
    };
  },
  order_cancelled(order) {
    return {
      subject: `Order ${order.number} was cancelled`,
      body: `Your order ${order.number} was cancelled. Any payment will be refunded.`,
    };
  },
};

export function renderNotification(kind: NotificationKind, order: Order, currency: Currency): Rendered {
  return templates[kind](order, currency);
}""")
t.test('src/notifications/templates.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, placeOrder } from '../lib/testing.ts';
import { renderNotification, templates } from './templates.ts';

describe('notification templates', () => {
  it('has one render function per kind', () => {
    assert.deepEqual(Object.keys(templates).sort(), ['order_cancelled', 'order_confirmed', 'order_shipped']);
    for (const render of Object.values(templates)) assert.equal(typeof render, 'function');
  });

  it('renders exactly what renderNotification does', () => {
    const { order } = placeOrder(createTestApp());
    for (const kind of ['order_confirmed', 'order_shipped', 'order_cancelled'] as const) {
      assert.deepEqual(templates[kind](order, 'USD'), renderNotification(kind, order, 'USD'));
    }
  });

  it('keeps the wording of the existing messages', () => {
    const { order } = placeOrder(createTestApp(), { price: 1500 });
    assert.equal(renderNotification('order_shipped', order, 'USD').subject, `Order ${order.number} has shipped`);
    assert.equal(renderNotification('order_cancelled', order, 'USD').body, `Your order ${order.number} was cancelled. Any payment will be refunded.`);
    assert.equal(renderNotification('order_confirmed', order, 'USD').body.split('\\n')[0], 'Thanks for your order!');
  });
});
""")
