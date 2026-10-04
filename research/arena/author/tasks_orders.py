from lib import Task

CL_ADDED = "- `GET /inventory/low-stock` for admins.\n"
CL_CHANGED = "- Product search ignores letter case.\n"
README_ORDERS_POST_ROW = "| POST | `/checkout`, `/orders/:id/cancel` | user |\n"

# ---------------------------------------------------------------------------
t = Task('rollback-stock', 'A failed checkout leaves stock reserved', 'bug', 2, """
When checkout fails after stock has been set aside (for example because the coupon code is wrong, or the cart is below the coupon's minimum), the reserved quantities are never given back. After a few failed attempts a product shows as sold out although nothing was sold.

A failed checkout must leave stock exactly as it was and keep the customer's cart intact, whatever the reason for the failure.
""")
t.rep('src/orders/checkout.ts', "import { reserve } from '../inventory/stock.ts';", "import { release, reserve } from '../inventory/stock.ts';")
t.rep('src/orders/checkout.ts', """  reserve(ctx, cart.lines);

  const orderId = ctx.store.nextId('ord');
  const invoice = issueInvoice(ctx, {
    orderId,
    userId: user.id,
    address,
    couponCode: input.couponCode,
    items: priced.lines.map((line) => ({
      productId: line.productId,
      description: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxClass: line.product.taxClass,
    })),
  });

  const lines: OrderLine[] = priced.lines.map((line) => ({
    productId: line.productId,
    name: line.name,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
  }));
  const shipping = quoteForOrder(ctx, { lines, shippingAddress: address }, input.method ?? 'standard');
  const now = ctx.clock.now().toISOString();
  const order = ctx.store.orders.insert({
    id: orderId,
    number: `${ctx.config.orderNumberPrefix}-${orderId.slice(4)}`,
    userId: user.id,
    status: 'confirmed',
    lines,
    subtotal: invoice.subtotal,
    discount: invoice.discount,
    tax: invoice.tax,
    shippingCost: shipping.cost,
    total: invoice.total,
    couponCode: invoice.couponCode,
    shippingAddress: address,
    invoiceId: invoice.id,
    trackingNumber: null,
    createdAt: now,
    updatedAt: now,
  });

  clearCart""", """  reserve(ctx, cart.lines);

  let order: Order;
  try {
    const orderId = ctx.store.nextId('ord');
    const invoice = issueInvoice(ctx, {
      orderId,
      userId: user.id,
      address,
      couponCode: input.couponCode,
      items: priced.lines.map((line) => ({
        productId: line.productId,
        description: line.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxClass: line.product.taxClass,
      })),
    });

    const lines: OrderLine[] = priced.lines.map((line) => ({
      productId: line.productId,
      name: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    }));
    const shipping = quoteForOrder(ctx, { lines, shippingAddress: address }, input.method ?? 'standard');
    const now = ctx.clock.now().toISOString();
    order = ctx.store.orders.insert({
      id: orderId,
      number: `${ctx.config.orderNumberPrefix}-${orderId.slice(4)}`,
      userId: user.id,
      status: 'confirmed',
      lines,
      subtotal: invoice.subtotal,
      discount: invoice.discount,
      tax: invoice.tax,
      shippingCost: shipping.cost,
      total: invoice.total,
      couponCode: invoice.couponCode,
      shippingAddress: address,
      invoiceId: invoice.id,
      trackingNumber: null,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    release(ctx, cart.lines);
    throw error;
  }

  clearCart""")
t.test('src/orders/checkout-rollback.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getCart } from '../cart/service.ts';
import { getStock } from '../inventory/stock.ts';
import { addProduct, createTestApp, signUp } from '../lib/testing.ts';

function cartWith(app: ReturnType<typeof createTestApp>, quantity: number, price = 1500, stock = 5) {
  const { user, token } = signUp(app.ctx);
  const product = addProduct(app.ctx, { price, stock });
  app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity } });
  return { user, token, product };
}

describe('failed checkouts', () => {
  it('release the stock when the coupon code is unknown', () => {
    const app = createTestApp();
    const { token, product, user } = cartWith(app, 2);
    const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0, couponCode: 'NOPE' } });
    assert.equal(res.status, 400);
    assert.equal(getStock(app.ctx, product.id).reserved, 0);
    assert.equal(getCart(app.ctx, user.id).lines.length, 1);
    assert.equal(app.ctx.store.invoices.all().length, 0);
  });

  it('release the stock when the cart is below the coupon minimum', () => {
    const app = createTestApp();
    const { token, product } = cartWith(app, 1, 1500);
    const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0, couponCode: 'FIVEOFF' } });
    assert.equal(res.status, 400);
    assert.equal(getStock(app.ctx, product.id).reserved, 0);
  });

  it('let the customer buy the last unit afterwards', () => {
    const app = createTestApp();
    const { token, product } = cartWith(app, 1, 1500, 1);
    app.call('POST', '/checkout', { token, body: { addressIndex: 0, couponCode: 'NOPE' } });
    assert.equal(app.call('POST', '/checkout', { token, body: { addressIndex: 0 } }).status, 201);
    assert.equal(getStock(app.ctx, product.id).reserved, 1);
  });
});
""")

# ---------------------------------------------------------------------------
t = Task('empty-cart', 'Checking out an empty cart creates a stray invoice', 'bug', 1, """
When a customer posts to checkout with nothing in their cart, we answer with a confusing shipping error ("nothing to ship"), but by then an invoice has already been created and a number has been used up.

Reject an empty cart straight away with a 400 and the message "cart is empty", before anything is reserved, invoiced or quoted.
""")
t.ins_after('src/orders/checkout.ts', "  const cart = getCart(ctx, user.id);\n", "  if (cart.lines.length === 0) throw badRequest('cart is empty');\n")
t.test('src/orders/empty-cart.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp, errorMessage, signUp } from '../lib/testing.ts';

describe('empty cart checkout', () => {
  it('is rejected up front', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx);
    const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
    assert.equal(res.status, 400);
    assert.equal(errorMessage(res), 'cart is empty');
    assert.equal(app.ctx.store.invoices.all().length, 0);
    assert.equal(app.ctx.store.orders.all().length, 0);
  });

  it('does not use up an invoice number', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx);
    app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
    const product = addProduct(app.ctx);
    app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 1 } });
    const order = app.call('POST', '/checkout', { token, body: { addressIndex: 0 } }).body as { invoiceId: string };
    assert.equal(order.invoiceId, 'inv_0001');
  });
});
""")
t.couples('line-limit', 'textual', "Both add a validation immediately after the cart is loaded at the top of checkout() in orders/checkout.ts.")

# ---------------------------------------------------------------------------
t = Task('line-limit', 'Limit how many units of one product fit in an order', 'feature', 2, """
A bot ordered thousands of units of one cheap product and tied up our stock. Add a per-line quantity limit at checkout: no single product may appear more than `maxLineQuantity` times in one order. The limit defaults to 10 and can be set with the `MAX_LINE_QUANTITY` environment variable.

A cart that breaks the limit must fail checkout with a 400 and the message "at most N units of <product name> per order" (N being the limit), without reserving stock or creating an invoice.
""")
t.rep('src/config.ts', "  maxCartLines: number;\n", "  maxCartLines: number;\n  /** Most units of one product allowed in a single order. */\n  maxLineQuantity: number;\n")
t.rep('src/config.ts', "  maxCartLines: 50,\n", "  maxCartLines: 50,\n  maxLineQuantity: 10,\n")
t.rep('src/config.ts', "    maxCartLines: intFrom(env.MAX_CART_LINES, defaultConfig.maxCartLines),\n", "    maxCartLines: intFrom(env.MAX_CART_LINES, defaultConfig.maxCartLines),\n    maxLineQuantity: intFrom(env.MAX_LINE_QUANTITY, defaultConfig.maxLineQuantity),\n")
t.ins_after('src/orders/checkout.ts', "  const cart = getCart(ctx, user.id);\n", """  for (const line of cart.lines) {
    if (line.quantity > ctx.config.maxLineQuantity) {
      const name = ctx.store.products.get(line.productId)?.name ?? line.productId;
      throw badRequest(`at most ${ctx.config.maxLineQuantity} units of ${name} per order`);
    }
  }
""")
t.test('src/orders/line-limit.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultConfig, loadConfig } from '../config.ts';
import { getStock } from '../inventory/stock.ts';
import { addProduct, createTestApp, errorMessage, signUp } from '../lib/testing.ts';

function checkoutWith(app: ReturnType<typeof createTestApp>, quantity: number) {
  const { token } = signUp(app.ctx);
  const product = addProduct(app.ctx, { name: 'Cheap widget', price: 100, stock: 1000 });
  app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity } });
  return { product, res: app.call('POST', '/checkout', { token, body: { addressIndex: 0 } }) };
}

describe('order line limit', () => {
  it('defaults to ten and can be set from the environment', () => {
    assert.equal(defaultConfig.maxLineQuantity, 10);
    assert.equal(loadConfig({ MAX_LINE_QUANTITY: '3' }).maxLineQuantity, 3);
  });

  it('accepts a line at the limit', () => {
    assert.equal(checkoutWith(createTestApp(), 10).res.status, 201);
  });

  it('rejects a line over the limit without touching stock or invoices', () => {
    const app = createTestApp();
    const { product, res } = checkoutWith(app, 11);
    assert.equal(res.status, 400);
    assert.equal(errorMessage(res), 'at most 10 units of Cheap widget per order');
    assert.equal(getStock(app.ctx, product.id).reserved, 0);
    assert.equal(app.ctx.store.invoices.all().length, 0);
  });

  it('follows the configured limit', () => {
    const app = createTestApp();
    app.ctx.config.maxLineQuantity = 2;
    assert.equal(checkoutWith(app, 3).res.status, 400);
  });
});
""")
t.couples('empty-cart', 'textual', "Both add a validation immediately after the cart is loaded at the top of checkout() in orders/checkout.ts.")

# ---------------------------------------------------------------------------
t = Task('order-note', 'Customers want to leave delivery notes on an order', 'feature', 2, """
Customers want to tell the courier things like "leave with the concierge". Let them add an optional free-text `note` when checking out.

The note is trimmed and stored on the order as `note` (an empty string when none was given or it is blank), and is returned wherever the order is. It may be at most 200 characters; a longer note fails checkout with a 400 and the message "note must be at most 200 characters". Orders that already exist get an empty note, which needs a numbered migration (registered with the others).
""")
t.rep('src/types.ts', "  invoiceId: string | null;\n  trackingNumber: string | null;\n  createdAt: string;", "  invoiceId: string | null;\n  trackingNumber: string | null;\n  /** Free-text delivery instructions from the customer. */\n  note: string;\n  createdAt: string;")
t.new('src/db/migrations/0006_order_note.ts', """
import type { Migration } from '../migrate.ts';

export const migration0006: Migration = {
  version: 6,
  name: 'order_note',
  up(store) {
    store.orders.addColumn('note', '');
  },
};
""")
t.rep('src/db/migrations/index.ts', "import { migration0005 } from './0005_user_roles.ts';\n", "import { migration0005 } from './0005_user_roles.ts';\nimport { migration0006 } from './0006_order_note.ts';\n")
t.rep('src/db/migrations/index.ts', "  migration0005,\n];", "  migration0005,\n  migration0006,\n];")
t.rep('src/orders/checkout.ts', "  couponCode?: string;\n  method?: ShippingMethod;\n}", "  couponCode?: string;\n  method?: ShippingMethod;\n  note?: string;\n}")
t.rep('src/orders/checkout.ts', "  if (!address) throw badRequest('choose a saved shipping address');\n", "  if (!address) throw badRequest('choose a saved shipping address');\n  const note = input.note?.trim() ?? '';\n  if (note.length > 200) throw badRequest('note must be at most 200 characters');\n")
t.rep('src/orders/checkout.ts', "    trackingNumber: null,\n    createdAt: now,", "    trackingNumber: null,\n    note,\n    createdAt: now,")
t.rep('src/orders/handlers.ts', "    couponCode: optionalString(body, 'couponCode'),\n", "    couponCode: optionalString(body, 'couponCode'),\n    note: optionalString(body, 'note'),\n")
t.test('src/db/order-note-migration.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runMigrations } from './migrate.ts';
import { migrations } from './migrations/index.ts';
import { Store } from './store.ts';

describe('migration 0006: order note', () => {
  it('gives orders that already exist an empty note', () => {
    const store = new Store();
    runMigrations(store, migrations.filter((m) => m.version <= 5));
    store.orders.insert({ id: 'ord_old' } as never);
    runMigrations(store);
    assert.equal(store.orders.require('ord_old').note, '');
  });

  it('adds the migration at the end of the registry', () => {
    assert.equal(migrations.at(-1)?.name, 'order_note');
  });
});
""")
t.test('src/orders/order-note.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp, errorMessage, signUp } from '../lib/testing.ts';
import type { Order } from '../types.ts';

function checkout(note?: string) {
  const app = createTestApp();
  const { token } = signUp(app.ctx);
  const product = addProduct(app.ctx);
  app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 1 } });
  const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0, note } });
  return { app, token, res };
}

describe('order notes', () => {
  it('stores a trimmed note and returns it with the order', () => {
    const { app, token, res } = checkout('  leave with the concierge  ');
    assert.equal(res.status, 201);
    assert.equal((res.body as Order).note, 'leave with the concierge');
    const fetched = app.call('GET', `/orders/${(res.body as Order).id}`, { token }).body as Order;
    assert.equal(fetched.note, 'leave with the concierge');
  });

  it('defaults to an empty note', () => {
    assert.equal((checkout().res.body as Order).note, '');
    assert.equal((checkout('   ').res.body as Order).note, '');
  });

  it('rejects notes over 200 characters but accepts exactly 200', () => {
    assert.equal(checkout('x'.repeat(200)).res.status, 201);
    const tooLong = checkout('x'.repeat(201)).res;
    assert.equal(tooLong.status, 400);
    assert.equal(errorMessage(tooLong), 'note must be at most 200 characters');
  });
});
""")

# ---------------------------------------------------------------------------
t = Task('total-with-shipping', 'The order total shown to customers leaves out shipping', 'bug', 2, """
Customers complain that the total in their confirmation email is lower than the amount they are asked to pay. The order `total` only covers goods and tax; shipping sits in a separate `shippingCost` field and is never added.

Make `total` the full amount payable: goods after discount, plus tax, plus shipping. `subtotal`, `discount`, `tax` and `shippingCost` keep their meaning. The invoice stays as it is (it does not include shipping), and the confirmation email must show the new order total.
""")
t.rep('src/orders/checkout.ts', "    total: invoice.total,\n", "    total: invoice.total + shipping.cost,\n")
t.rep('src/types.ts', "  /** Goods after discount, plus tax. Shipping is tracked separately in `shippingCost`. */\n", "  /** Everything payable: goods after discount, plus tax, plus shipping. */\n")
t.ins_after('CHANGELOG.md', CL_CHANGED, "- The order `total` includes shipping.\n")
t.test('src/orders/total-with-shipping.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, ON_ADDRESS, placeOrder, US_ADDRESS } from '../lib/testing.ts';

describe('order total', () => {
  it('includes shipping on top of goods and tax', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { price: 10000, address: US_ADDRESS });
    assert.equal(order.shippingCost, 500);
    assert.equal(order.total, order.subtotal - order.discount + order.tax + order.shippingCost);
    assert.equal(order.total, 10000 + 650 + 500);
  });

  it('works with discounts and cross-border shipping', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { price: 10000, address: ON_ADDRESS, couponCode: 'WELCOME10' });
    assert.equal(order.shippingCost, 1200);
    assert.equal(order.total, 9000 + 1170 + 1200);
  });

  it('leaves the invoice without shipping', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { price: 10000, address: US_ADDRESS });
    assert.equal(app.ctx.store.invoices.require(order.invoiceId!).total, 10650);
  });

  it('shows the new total in the confirmation email', () => {
    const app = createTestApp();
    placeOrder(app, { price: 10000, address: US_ADDRESS });
    assert.match(app.mailer.sent[0].body, /Total: \\$111\\.50$/);
  });
});
""")
t.couples('signature', 'semantic', "total-with-shipping redefines Order.total to include shipping; signature compares order.total with a threshold and its test sits just under it. Merges cleanly, the shipping amount then pushes the order over the threshold.")

# ---------------------------------------------------------------------------
t = Task('reorder', 'Let customers reorder a previous order', 'feature', 2, """
Add `POST /orders/:id/reorder`, which puts the lines of one of the caller's earlier orders back into their cart: same products, same quantities, added to whatever is already in the cart. Respond 200 with `{ "added": [{ "productId", "quantity" }], "skipped": [productId] }`. Products that are no longer sold (inactive) are skipped rather than failing the request. Someone else's order, or an unknown one, is a 404 (admins do not get to reorder other people's orders either).
""")
t.rep('src/orders/service.ts', "import { conflict, notFound } from '../lib/errors.ts';", "import { addItem } from '../cart/service.ts';\nimport { conflict, notFound } from '../lib/errors.ts';")
t.rep('src/orders/service.ts', "import type { AppContext, Order, OrderStatus, User } from '../types.ts';", "import type { AppContext, CartLine, Order, OrderStatus, User } from '../types.ts';")
t.append('src/orders/service.ts', """
/** Put the lines of one of the user's own earlier orders back into their cart. */
export function reorder(ctx: AppContext, user: User, id: string): { added: CartLine[]; skipped: string[] } {
  const order = getOrder(ctx, id);
  if (order.userId !== user.id) throw notFound('order');
  const added: CartLine[] = [];
  const skipped: string[] = [];
  for (const line of order.lines) {
    if (!ctx.store.products.get(line.productId)?.active) {
      skipped.push(line.productId);
      continue;
    }
    addItem(ctx, user.id, line.productId, line.quantity);
    added.push({ productId: line.productId, quantity: line.quantity });
  }
  return { added, skipped };
}
""")
t.rep('src/orders/handlers.ts', "import { cancelOrder, getVisibleOrder, listOrders } from './service.ts';", "import { cancelOrder, getVisibleOrder, listOrders, reorder as reorderOrder } from './service.ts';")
t.append('src/orders/handlers.ts', "\nexport const reorder: Handler = (req, ctx) => ok(reorderOrder(ctx, req.user!, req.params.id));\n")
t.rep('src/routes.ts', "  router.add('POST', '/orders/:id/cancel', 'user', orders.cancel);\n", "  router.add('POST', '/orders/:id/cancel', 'user', orders.cancel);\n  router.add('POST', '/orders/:id/reorder', 'user', orders.reorder);\n")
t.rep('README.md', README_ORDERS_POST_ROW, "| POST | `/checkout`, `/orders/:id/cancel`, `/orders/:id/reorder` | user |\n")
t.ins_after('CHANGELOG.md', CL_ADDED, "- `POST /orders/:id/reorder` refills the cart from an earlier order.\n")
t.test('src/orders/reorder.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addItem, getCart } from '../cart/service.ts';
import { createTestApp, placeOrder, signUp } from '../lib/testing.ts';

describe('reorder', () => {
  it('puts the order\\'s lines back into the cart', () => {
    const app = createTestApp();
    const { order, token, user, product } = placeOrder(app, { quantity: 3 });
    const res = app.call('POST', `/orders/${order.id}/reorder`, { token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { added: [{ productId: product.id, quantity: 3 }], skipped: [] });
    assert.deepEqual(getCart(app.ctx, user.id).lines, [{ productId: product.id, quantity: 3 }]);
  });

  it('adds to what is already in the cart', () => {
    const app = createTestApp();
    const { order, token, user, product } = placeOrder(app, { quantity: 2 });
    addItem(app.ctx, user.id, product.id, 1);
    app.call('POST', `/orders/${order.id}/reorder`, { token });
    assert.equal(getCart(app.ctx, user.id).lines[0].quantity, 3);
  });

  it('skips products that are no longer sold', () => {
    const app = createTestApp();
    const { order, token, user, product } = placeOrder(app);
    app.ctx.store.products.update(product.id, { active: false });
    const res = app.call('POST', `/orders/${order.id}/reorder`, { token });
    assert.deepEqual(res.body, { added: [], skipped: [product.id] });
    assert.equal(getCart(app.ctx, user.id).lines.length, 0);
  });

  it('treats other people\\'s orders as missing, admins included', () => {
    const app = createTestApp();
    const { order } = placeOrder(app);
    const stranger = signUp(app.ctx, 'stranger@example.com');
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    assert.equal(app.call('POST', `/orders/${order.id}/reorder`, { token: stranger.token }).status, 404);
    assert.equal(app.call('POST', `/orders/${order.id}/reorder`, { token: admin.token }).status, 404);
    assert.equal(app.call('POST', '/orders/ord_9999/reorder', { token: stranger.token }).status, 404);
  });
});
""")

# ---------------------------------------------------------------------------
t = Task('tracking-on-shipment', 'Tracking numbers belong to shipments, not orders', 'refactor', 3, """
An order can ship in several parcels, but we keep a single `trackingNumber` on the order itself. Move the tracking number to the shipment.

Shipments get a `trackingNumber`, and orders stop having one. `POST /orders/:id/ship` still takes a tracking number and still returns the updated order (which no longer carries it), and `GET /orders/:id/shipment` returns the shipment with its `trackingNumber`. Shipments that already exist take over the tracking number of their order, so a numbered migration is needed to copy it across and remove the order column. The shared types live in src/types.ts.
""")
t.rep('src/types.ts', "  invoiceId: string | null;\n  trackingNumber: string | null;\n  createdAt: string;", "  invoiceId: string | null;\n  createdAt: string;")
t.rep('src/types.ts', "  status: ShipmentStatus;\n  shippedAt: string | null;\n}", "  status: ShipmentStatus;\n  trackingNumber: string | null;\n  shippedAt: string | null;\n}")
t.new('src/db/migrations/0006_shipment_tracking.ts', """
import type { Migration } from '../migrate.ts';

export const migration0006: Migration = {
  version: 6,
  name: 'shipment_tracking',
  up(store) {
    store.shipments.addColumn('trackingNumber', null);
    for (const shipment of store.shipments.all()) {
      const order = store.orders.get(shipment.orderId) as { trackingNumber?: string | null } | undefined;
      store.shipments.update(shipment.id, { trackingNumber: order?.trackingNumber ?? null });
    }
    store.orders.dropColumn('trackingNumber');
  },
};
""")
t.rep('src/db/migrations/index.ts', "import { migration0005 } from './0005_user_roles.ts';\n", "import { migration0005 } from './0005_user_roles.ts';\nimport { migration0006 } from './0006_shipment_tracking.ts';\n")
t.rep('src/db/migrations/index.ts', "  migration0005,\n];", "  migration0005,\n  migration0006,\n];")
t.rep('src/orders/checkout.ts', "    invoiceId: invoice.id,\n    trackingNumber: null,\n", "    invoiceId: invoice.id,\n")
t.rep('src/shipping/service.ts', "    status: 'shipped',\n    shippedAt: now,\n  });\n  const updated = ctx.store.orders.update(orderId, { status: 'shipped', trackingNumber, updatedAt: now });",
      "    status: 'shipped',\n    trackingNumber,\n    shippedAt: now,\n  });\n  const updated = ctx.store.orders.update(orderId, { status: 'shipped', updatedAt: now });")
t.rep('src/shipping/handlers.ts', "  return ok({ ...shipment, trackingNumber: order.trackingNumber });", "  return ok(shipment);")
t.ins_after('CHANGELOG.md', CL_CHANGED, "- Tracking numbers are stored on shipments; orders no longer have a `trackingNumber`.\n")
t.test('src/db/shipment-tracking-migration.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runMigrations } from './migrate.ts';
import { migrations } from './migrations/index.ts';
import { Store } from './store.ts';

describe('migration 0006: shipment tracking', () => {
  it('copies existing tracking numbers onto shipments and drops the order column', () => {
    const store = new Store();
    runMigrations(store, migrations.filter((m) => m.version <= 5));
    store.orders.insert({ id: 'ord_1', trackingNumber: 'OLD-1' } as never);
    store.shipments.insert({ id: 'shp_1', orderId: 'ord_1' } as never);
    store.shipments.insert({ id: 'shp_2', orderId: 'ord_missing' } as never);
    runMigrations(store);
    assert.equal(store.shipments.require('shp_1').trackingNumber, 'OLD-1');
    assert.equal(store.shipments.require('shp_2').trackingNumber, null);
    assert.ok(!('trackingNumber' in store.orders.require('ord_1')));
  });
});
""")
t.test('src/shipping/shipment-tracking.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, placeOrder, signUp } from '../lib/testing.ts';
import type { Order } from '../types.ts';

describe('tracking numbers on shipments', () => {
  it('stores the tracking number on the shipment and not on the order', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app);
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    const shipped = app.call('POST', `/orders/${order.id}/ship`, { token: admin.token, body: { trackingNumber: 'TRK-5' } });
    assert.equal(shipped.status, 200);
    assert.equal((shipped.body as Order).status, 'shipped');
    assert.ok(!('trackingNumber' in (shipped.body as object)));
    assert.ok(!('trackingNumber' in app.ctx.store.orders.require(order.id)));
    const shipment = app.call('GET', `/orders/${order.id}/shipment`, { token }).body as { trackingNumber: string };
    assert.equal(shipment.trackingNumber, 'TRK-5');
    assert.equal(app.ctx.store.shipments.all()[0].trackingNumber, 'TRK-5');
  });

  it('new orders do not carry a tracking number either', () => {
    const { order } = placeOrder(createTestApp());
    assert.ok(!('trackingNumber' in order));
  });

});
""")
t.couples('tracking-email', 'semantic', "tracking-on-shipment moves trackingNumber from Order to Shipment; tracking-email's template reads order.trackingNumber. Merges cleanly, the shipped email then says the tracking number is missing.")

# ---------------------------------------------------------------------------
t = Task('paginate-total', 'Paged lists should report the total number of results', 'feature', 2, """
API clients that page through products or orders cannot tell how many pages there are. Change the shared `paginate()` helper in lib/pagination.ts so that it returns `{ items, total }`: the requested page of items, and the number of items there were before paging. Use that on the product and order list endpoints to send the total in an `x-total-count` response header. The response bodies stay plain JSON arrays so existing clients keep working.
""")
t.rep('src/lib/pagination.ts', """const MAX_LIMIT = 100;

/**
 * Slice `items` according to `?limit=` and `?offset=`. Bad values fall back to the
 * defaults rather than failing the request.
 */
export function paginate<T>(items: T[], query: Record<string, string>, defaultLimit = 20): T[] {
  const requested = Number.parseInt(query.limit ?? '', 10);
  const limit = Number.isNaN(requested) ? defaultLimit : Math.min(Math.max(requested, 1), MAX_LIMIT);
  const offset = Math.max(Number.parseInt(query.offset ?? '', 10) || 0, 0);
  return items.slice(offset, offset + limit);
}""", """const MAX_LIMIT = 100;

export interface Page<T> {
  items: T[];
  /** How many items there were before paging. */
  total: number;
}

/**
 * Slice `items` according to `?limit=` and `?offset=`. Bad values fall back to the
 * defaults rather than failing the request.
 */
export function paginate<T>(items: T[], query: Record<string, string>, defaultLimit = 20): Page<T> {
  const requested = Number.parseInt(query.limit ?? '', 10);
  const limit = Number.isNaN(requested) ? defaultLimit : Math.min(Math.max(requested, 1), MAX_LIMIT);
  const offset = Math.max(Number.parseInt(query.offset ?? '', 10) || 0, 0);
  return { items: items.slice(offset, offset + limit), total: items.length };
}""")
t.rep('src/catalog/handlers.ts', "import { created, ok } from '../router.ts';", "import { created, json, ok } from '../router.ts';")
t.rep('src/catalog/handlers.ts', "  return ok(paginate(products, req.query, ctx.config.pageSize));", "  const page = paginate(products, req.query, ctx.config.pageSize);\n  return json(200, page.items, { 'x-total-count': String(page.total) });")
t.rep('src/orders/handlers.ts', "import { created, ok } from '../router.ts';", "import { created, json, ok } from '../router.ts';")
t.rep('src/orders/handlers.ts', """export const list: Handler = (req, ctx) =>
  ok(paginate(listOrders(ctx, req.user!.id), req.query, ctx.config.pageSize));""", """export const list: Handler = (req, ctx) => {
  const page = paginate(listOrders(ctx, req.user!.id), req.query, ctx.config.pageSize);
  return json(200, page.items, { 'x-total-count': String(page.total) });
};""")
t.ins_after('CHANGELOG.md', CL_CHANGED, "- Product and order lists send an `x-total-count` header.\n")
t.test('src/lib/pagination.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { paginate } from './pagination.ts';

const items = Array.from({ length: 150 }, (_, i) => i);

describe('paginate', () => {
  it('returns the first page by default, with the total', () => {
    const page = paginate(items, {});
    assert.equal(page.items.length, 20);
    assert.equal(page.items[0], 0);
    assert.equal(page.total, 150);
  });

  it('honours limit and offset and still reports the full total', () => {
    const page = paginate(items, { limit: '3', offset: '10' });
    assert.deepEqual(page.items, [10, 11, 12]);
    assert.equal(page.total, 150);
  });

  it('clamps the limit and ignores garbage', () => {
    assert.equal(paginate(items, { limit: '1000' }).items.length, 100);
    assert.equal(paginate(items, { limit: 'abc', offset: '-4' }).items.length, 20);
    assert.deepEqual(paginate([], {}), { items: [], total: 0 });
  });
});
""")
t.test('src/catalog/total-count.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp, placeOrder } from '../lib/testing.ts';
import type { Order, Product } from '../types.ts';

describe('x-total-count header', () => {
  it('reports the number of products before paging', () => {
    const app = createTestApp();
    for (let i = 0; i < 25; i++) addProduct(app.ctx);
    const res = app.call('GET', '/products', { query: { limit: '5' } });
    assert.equal((res.body as Product[]).length, 5);
    assert.equal(res.headers['x-total-count'], '25');
  });

  it('counts only the products matching the filters', () => {
    const app = createTestApp();
    addProduct(app.ctx, { category: 'coffee' });
    addProduct(app.ctx, { category: 'coffee' });
    addProduct(app.ctx, { category: 'tea' });
    const res = app.call('GET', '/products', { query: { category: 'coffee', limit: '1' } });
    assert.equal(res.headers['x-total-count'], '2');
  });

  it('reports the number of orders and keeps the body an array', () => {
    const app = createTestApp();
    const { token, product } = placeOrder(app);
    for (let i = 0; i < 2; i++) {
      app.clock.advance(1000);
      app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 1 } });
      app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
    }
    const res = app.call('GET', '/orders', { token, query: { limit: '2' } });
    assert.ok(Array.isArray(res.body));
    assert.equal((res.body as Order[]).length, 2);
    assert.equal(res.headers['x-total-count'], '3');
  });
});
""")
t.couples('invoice-list', 'semantic', "paginate-total changes paginate() to return a {items, total} page and updates the existing callers; invoice-list adds a new caller that returns paginate()'s result as the response body. Merges cleanly, the new endpoint then returns an object instead of an array.")

# ---------------------------------------------------------------------------
t = Task('money-grouping', 'Show thousands separators in displayed amounts', 'feature', 1, """
Large amounts are hard to read in emails and invoices ("$1234567.89"). Format money with a comma between groups of thousands: `$1,234,567.89`, `-$1,234.50`, `€12,000.00`. Amounts below 1,000 look exactly as they do today.
""")
t.rep('src/lib/money.ts', "  const whole = Math.floor(abs / 100);\n", "  const whole = Math.floor(abs / 100).toLocaleString('en-US');\n")
t.ins_after('CHANGELOG.md', CL_CHANGED, "- Amounts of 1,000 or more are shown with thousands separators.\n")
t.test('src/lib/money-format.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatMoney } from './money.ts';

describe('formatMoney digit grouping', () => {
  it('groups thousands with commas', () => {
    assert.equal(formatMoney(123456789), '$1,234,567.89');
    assert.equal(formatMoney(100000), '$1,000.00');
    assert.equal(formatMoney(1200000, 'EUR'), '€12,000.00');
  });

  it('keeps the sign in front and small amounts unchanged', () => {
    assert.equal(formatMoney(-123450), '-$1,234.50');
    assert.equal(formatMoney(99999), '$999.99');
    assert.equal(formatMoney(5), '$0.05');
    assert.equal(formatMoney(0, 'GBP'), '£0.00');
  });
});
""")
t.test('src/orders/confirmation-grouping.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, placeOrder, US_ADDRESS } from '../lib/testing.ts';

describe('order confirmation with digit grouping', () => {
  it('groups thousands in line items and the total', () => {
    const app = createTestApp();
    placeOrder(app, { price: 150000, quantity: 2, address: US_ADDRESS, stock: 5 });
    const body = app.mailer.sent[0].body;
    assert.match(body, /2 x Product \\d+ - \\$3,000\\.00/);
    assert.match(body, /Total: \\$3,195\\.00$/);
  });

  it('leaves small orders unchanged', () => {
    const app = createTestApp();
    placeOrder(app, { price: 4000, address: US_ADDRESS });
    assert.match(app.mailer.sent[0].body, /Total: \\$42\\.60$/);
  });
});
""")
t.couples('invoice-text', 'semantic', "money-grouping changes formatMoney to print $1,000.00; invoice-text's test asserts amounts printed as $1000.00. Merges cleanly, the text invoice test then fails.")

# ---------------------------------------------------------------------------
t = Task('signature', 'Require a signature for high-value deliveries', 'feature', 2, """
Parcels worth $250 or more should be delivered against a signature. When an order is shipped, record `signatureRequired` on its shipment: true if the order's `total` is at least `signatureThreshold`, false otherwise. The threshold is a shop setting, 25000 cents by default and overridable with the `SIGNATURE_THRESHOLD` environment variable. The shipment endpoint returns the new field.
""")
t.rep('src/config.ts', "  pageSize: number;\n}", "  pageSize: number;\n  /** Orders with a total at or above this many cents are delivered against a signature. */\n  signatureThreshold: number;\n}")
t.rep('src/config.ts', "  pageSize: 20,\n};", "  pageSize: 20,\n  signatureThreshold: 25000,\n};")
t.rep('src/config.ts', "    lowStockThreshold: intFrom(env.LOW_STOCK_THRESHOLD, defaultConfig.lowStockThreshold),\n", "    lowStockThreshold: intFrom(env.LOW_STOCK_THRESHOLD, defaultConfig.lowStockThreshold),\n    signatureThreshold: intFrom(env.SIGNATURE_THRESHOLD, defaultConfig.signatureThreshold),\n")
t.rep('src/types.ts', "  status: ShipmentStatus;\n  shippedAt: string | null;\n}", "  status: ShipmentStatus;\n  signatureRequired: boolean;\n  shippedAt: string | null;\n}")
t.rep('src/shipping/service.ts', "    status: 'shipped',\n    shippedAt: now,\n  });", "    status: 'shipped',\n    signatureRequired: order.total >= ctx.config.signatureThreshold,\n    shippedAt: now,\n  });")
t.ins_after('README.md', '| `LOW_STOCK_THRESHOLD` | `5` | Available quantity at or below which a product counts as low on stock |\n', "| `SIGNATURE_THRESHOLD` | `25000` | Order total (cents) from which delivery needs a signature |\n")
t.ins_after('CHANGELOG.md', CL_ADDED, "- Shipments of high-value orders are flagged `signatureRequired`.\n")
t.test('src/shipping/signature.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultConfig, loadConfig } from '../config.ts';
import { createTestApp, placeOrder, signUp, US_ADDRESS } from '../lib/testing.ts';

function shipmentFor(price: number) {
  const app = createTestApp();
  const { order, token } = placeOrder(app, { price, address: US_ADDRESS });
  const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
  app.call('POST', `/orders/${order.id}/ship`, { token: admin.token, body: { trackingNumber: 'TRK-1' } });
  const res = app.call('GET', `/orders/${order.id}/shipment`, { token });
  return res.body as { signatureRequired: boolean };
}

describe('signature on delivery', () => {
  it('has a $250 default threshold that can be overridden', () => {
    assert.equal(defaultConfig.signatureThreshold, 25000);
    assert.equal(loadConfig({ SIGNATURE_THRESHOLD: '10000' }).signatureThreshold, 10000);
  });

  it('is not required just under the threshold', () => {
    assert.equal(shipmentFor(23400).signatureRequired, false);
  });

  it('is required for high-value orders', () => {
    assert.equal(shipmentFor(30000).signatureRequired, true);
  });
});
""")
t.couples('total-with-shipping', 'semantic', "signature compares order.total with a threshold and its test sits just under it ($234.00 + 6.5% tax = $249.21); total-with-shipping adds $5 shipping to order.total. Merges cleanly, the order then crosses the threshold.")
