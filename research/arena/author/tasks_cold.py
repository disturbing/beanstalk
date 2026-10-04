from lib import Task

# ---------------------------------------------------------------------------
t = Task('hidden-product', 'Retired products are still visible by id', 'bug', 1, """
When a product is retired (`active` set to false) it disappears from the catalogue list, but `GET /products/:id` still returns it, so old links keep working and customers can see prices for things we no longer sell.

Make the public product endpoint answer 404 for retired products. Admin tooling that reads products through the service layer is not affected, and the product list behaves as before.
""")
t.rep('src/catalog/handlers.ts', "import { paginate } from '../lib/pagination.ts';", "import { notFound } from '../lib/errors.ts';\nimport { paginate } from '../lib/pagination.ts';")
t.rep('src/catalog/handlers.ts', "export const get: Handler = (req, ctx) => ok(getProduct(ctx, req.params.id));", """export const get: Handler = (req, ctx) => {
  const product = getProduct(ctx, req.params.id);
  if (!product.active) throw notFound('product');
  return ok(product);
};""")
t.test('src/catalog/hidden-product.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp, signUp } from '../lib/testing.ts';
import { getProduct, updateProduct } from './service.ts';

describe('retired products', () => {
  it('answer 404 on the public endpoint', () => {
    const app = createTestApp();
    const product = addProduct(app.ctx);
    assert.equal(app.call('GET', `/products/${product.id}`).status, 200);
    updateProduct(app.ctx, product.id, { active: false });
    const res = app.call('GET', `/products/${product.id}`);
    assert.equal(res.status, 404);
  });

  it('can be brought back by an admin', () => {
    const app = createTestApp();
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    const product = addProduct(app.ctx);
    app.call('PATCH', `/products/${product.id}`, { token: admin.token, body: { active: false } });
    assert.equal(app.call('GET', `/products/${product.id}`).status, 404);
    app.call('PATCH', `/products/${product.id}`, { token: admin.token, body: { active: true } });
    assert.equal(app.call('GET', `/products/${product.id}`).status, 200);
  });

  it('are still readable through the service layer', () => {
    const app = createTestApp();
    const product = addProduct(app.ctx);
    updateProduct(app.ctx, product.id, { active: false });
    assert.equal(getProduct(app.ctx, product.id).active, false);
  });
});
""")

# ---------------------------------------------------------------------------
t = Task('cart-stock', 'Carts accept more units than are in stock', 'bug', 2, """
A customer put 50 units of a product with 3 in stock into their cart and only found out at checkout.

Adding to the cart, or raising a line's quantity, must fail with a 409 and the message "only N left in stock" (N being what is still available: on hand minus reserved, never below zero) when the line's resulting quantity would be more than that. Anything within the available stock keeps working, and lowering a quantity is always allowed.
""")
t.rep('src/cart/service.ts', "import { badRequest } from '../lib/errors.ts';", "import { assertAvailable } from '../inventory/stock.ts';\nimport { badRequest } from '../lib/errors.ts';")
t.ins_after('src/inventory/stock.ts', """export function availableQuantity(level: StockLevel): number {
  return level.onHand - level.reserved;
}
""", """
/** Fail with a 409 unless `quantity` units of the product could be reserved right now. */
export function assertAvailable(ctx: AppContext, productId: string, quantity: number): void {
  const available = availableQuantity(getStock(ctx, productId));
  if (quantity > available) throw conflict(`only ${Math.max(available, 0)} left in stock`);
}
""")
t.rep('src/cart/service.ts', "  const existing = cart.lines.find((line) => line.productId === productId);\n  if (existing) {", "  const existing = cart.lines.find((line) => line.productId === productId);\n  assertAvailable(ctx, productId, (existing?.quantity ?? 0) + quantity);\n  if (existing) {")
t.rep('src/cart/service.ts', "  if (!line) throw badRequest('product is not in the cart');\n", "  if (!line) throw badRequest('product is not in the cart');\n  if (quantity > line.quantity) assertAvailable(ctx, productId, quantity);\n")
t.rep('README.md', "- Stock is reserved at checkout and released when an order is cancelled.\n", "- Stock is reserved at checkout and released when an order is cancelled. Carts cannot hold more than is available.\n")
t.test('src/cart/stock-check.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reserve } from '../inventory/stock.ts';
import { addProduct, createTestApp, errorMessage, signUp } from '../lib/testing.ts';
import { getCart } from './service.ts';

function setup(stock: number) {
  const app = createTestApp();
  const { user, token } = signUp(app.ctx);
  const product = addProduct(app.ctx, { stock });
  const add = (quantity: number) => app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity } });
  const set = (quantity: number) => app.call('PATCH', `/cart/items/${product.id}`, { token, body: { quantity } });
  return { app, user, product, add, set };
}

describe('cart stock check', () => {
  it('accepts quantities up to the stock on hand', () => {
    const { add, app, user } = setup(3);
    assert.equal(add(3).status, 201);
    assert.equal(getCart(app.ctx, user.id).lines[0].quantity, 3);
  });

  it('refuses to add more than is available, counting what is already in the cart', () => {
    const { add, app, user } = setup(3);
    assert.equal(add(2).status, 201);
    const res = add(2);
    assert.equal(res.status, 409);
    assert.equal(errorMessage(res), 'only 3 left in stock');
    assert.equal(getCart(app.ctx, user.id).lines[0].quantity, 2);
  });

  it('refuses to raise a line past the stock but lets it go down', () => {
    const { add, set } = setup(4);
    add(2);
    assert.equal(set(5).status, 409);
    assert.equal(set(4).status, 200);
    assert.equal(set(1).status, 200);
  });

  it('does not count stock reserved for other orders as available', () => {
    const { add, app, product } = setup(5);
    reserve(app.ctx, [{ productId: product.id, quantity: 4 }]);
    const res = add(2);
    assert.equal(res.status, 409);
    assert.equal(errorMessage(res), 'only 1 left in stock');
  });

  it('says zero when everything is reserved or sold', () => {
    const { add } = setup(0);
    assert.equal(errorMessage(add(1)), 'only 0 left in stock');
  });
});
""")

# ---------------------------------------------------------------------------
t = Task('password-policy', 'Reject weak passwords at registration', 'feature', 1, """
Registration currently accepts a one-character password. Require passwords to be at least 8 characters long, and reject a password that is the same as the account's email address (compared ignoring case). Registration must fail with a 400 and the message "password must be at least 8 characters" or "password must not be your email address" respectively, before any account is created.
""")
t.rep('src/auth/password.ts', "import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';\n", "import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';\nimport { badRequest } from '../lib/errors.ts';\n")
t.append('src/auth/password.ts', """
/** Reject passwords that are too short or are simply the account's email address. */
export function assertAcceptablePassword(password: string, email: string): void {
  if (password.length < 8) throw badRequest('password must be at least 8 characters');
  if (password.toLowerCase() === email.toLowerCase()) {
    throw badRequest('password must not be your email address');
  }
}
""")
t.rep('src/users/service.ts', "import { hashPassword } from '../auth/password.ts';", "import { assertAcceptablePassword, hashPassword } from '../auth/password.ts';")
t.ins_after('src/users/service.ts', "  const email = input.email.trim();\n", "  assertAcceptablePassword(input.password, email);\n")
t.test('src/users/password-policy.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, errorMessage } from '../lib/testing.ts';

const register = (app: ReturnType<typeof createTestApp>, password: string, email = 'ada@example.com') =>
  app.call('POST', '/users', { body: { email, name: 'Ada', password } });

describe('password policy', () => {
  it('rejects passwords shorter than 8 characters', () => {
    const app = createTestApp();
    const res = register(app, 'short12');
    assert.equal(res.status, 400);
    assert.equal(errorMessage(res), 'password must be at least 8 characters');
    assert.equal(app.ctx.store.users.all().length, 0);
  });

  it('accepts exactly 8 characters', () => {
    assert.equal(register(createTestApp(), 'abcd1234').status, 201);
  });

  it('rejects the email address as a password, ignoring case', () => {
    const app = createTestApp();
    const res = register(app, 'ADA@example.com');
    assert.equal(res.status, 400);
    assert.equal(errorMessage(res), 'password must not be your email address');
  });
});
""")
t.couples('email-case', 'textual', "Both change the first lines of registerUser() in users/service.ts: one modifies the email normalisation line, the other adds password checks right after it.")

# ---------------------------------------------------------------------------
t = Task('email-case', 'Customers can register twice with different capitalisation', 'bug', 1, """
"Ada@Example.com" and "ada@example.com" are treated as two different customers, so one person can end up with two accounts, and a customer who signed up as "Ada@Example.com" cannot log in by typing their address in lower case.

Treat email addresses case-insensitively: store them lower-cased, and look them up regardless of case (whitespace around an address is still ignored). Registering an address that exists in another capitalisation must fail with the usual 409.
""")
t.rep('src/users/service.ts', "  return ctx.store.users.findOne((u) => u.email === email.trim());", "  return ctx.store.users.findOne((u) => u.email === email.trim().toLowerCase());")
t.rep('src/users/service.ts', "  const email = input.email.trim();\n", "  const email = input.email.trim().toLowerCase();\n")
t.test('src/users/email-case.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp } from '../lib/testing.ts';
import type { User } from '../types.ts';

const body = { name: 'Ada', password: 'correct horse' };

describe('email case', () => {
  it('stores addresses in lower case', () => {
    const app = createTestApp();
    const res = app.call('POST', '/users', { body: { ...body, email: '  Ada@Example.COM ' } });
    assert.equal(res.status, 201);
    assert.equal((res.body as User).email, 'ada@example.com');
  });

  it('refuses a second account that differs only in case', () => {
    const app = createTestApp();
    app.call('POST', '/users', { body: { ...body, email: 'Ada@Example.com' } });
    assert.equal(app.call('POST', '/users', { body: { ...body, email: 'ada@example.com' } }).status, 409);
    assert.equal(app.ctx.store.users.all().length, 1);
  });

  it('lets customers log in with any capitalisation', () => {
    const app = createTestApp();
    app.call('POST', '/users', { body: { ...body, email: 'Ada@Example.com' } });
    for (const email of ['ada@example.com', 'ADA@EXAMPLE.COM', ' Ada@Example.com ']) {
      assert.equal(app.call('POST', '/auth/login', { body: { email, password: body.password } }).status, 200, email);
    }
  });
});
""")
t.couples('password-policy', 'textual', "Both change the first lines of registerUser() in users/service.ts: one modifies the email normalisation line, the other adds password checks right after it.")

# ---------------------------------------------------------------------------
t = Task('tracking-email', 'Shipping emails should include the tracking number', 'feature', 1, """
Customers keep writing to ask where their parcel is. The "order shipped" email should tell them: add a line `Tracking number: <number>` after the existing sentence in the message body, using the tracking number recorded when the order was shipped.
""")
t.rep('src/notifications/templates.ts', "        body: `Your order ${order.number} is on its way.`,", "        body: `Your order ${order.number} is on its way.\\nTracking number: ${order.trackingNumber}`,")
t.test('src/notifications/tracking-email.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, placeOrder, signUp } from '../lib/testing.ts';

describe('shipped email', () => {
  it('includes the tracking number', () => {
    const app = createTestApp();
    const { order } = placeOrder(app);
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    app.call('POST', `/orders/${order.id}/ship`, { token: admin.token, body: { trackingNumber: 'TRK-9981' } });
    const mail = app.mailer.sent.at(-1)!;
    assert.match(mail.subject, /has shipped/);
    assert.equal(mail.body, `Your order ${order.number} is on its way.\\nTracking number: TRK-9981`);
  });

  it('is what the customer sees in their notification list', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app);
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    app.call('POST', `/orders/${order.id}/ship`, { token: admin.token, body: { trackingNumber: 'ZZ-42' } });
    const list = app.call('GET', '/notifications', { token }).body as { kind: string; body: string }[];
    assert.match(list[0].body, /Tracking number: ZZ-42$/);
  });
});
""")
t.couples('tracking-on-shipment', 'semantic', "tracking-email reads order.trackingNumber in the shipped-email template; tracking-on-shipment moves the tracking number to the shipment and removes it from the order. Merges cleanly, the email then prints an undefined tracking number.")

# ---------------------------------------------------------------------------
t = Task('reserve-atomic', 'Stock reservations should be all or nothing', 'bug', 2, """
If a cart has three lines and the third is out of stock, checkout fails with a 409, but the first two lines stay reserved, so the stock of those products leaks away with every failed attempt.

Reserving a group of lines in inventory/stock.ts must be all or nothing: if any line cannot be covered, nothing at all is reserved and the error names the first line that is short.
""")
t.rep('src/inventory/stock.ts', """export function reserve(ctx: AppContext, lines: CartLine[]): void {
  for (const line of lines) {
    const level = getStock(ctx, line.productId);
    if (availableQuantity(level) < line.quantity) {
      throw conflict(`not enough stock for ${line.productId}`);
    }
    setReserved(ctx, level, level.reserved + line.quantity);
  }
}""", """export function reserve(ctx: AppContext, lines: CartLine[]): void {
  for (const line of lines) {
    if (availableQuantity(getStock(ctx, line.productId)) < line.quantity) {
      throw conflict(`not enough stock for ${line.productId}`);
    }
  }
  for (const line of lines) {
    const level = getStock(ctx, line.productId);
    setReserved(ctx, level, level.reserved + line.quantity);
  }
}""")
t.test('src/inventory/atomic-reserve.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp, signUp } from '../lib/testing.ts';
import { getStock, reserve } from './stock.ts';

describe('atomic reservations', () => {
  it('reserve nothing when one line is short', () => {
    const app = createTestApp();
    const a = addProduct(app.ctx, { stock: 5 });
    const b = addProduct(app.ctx, { stock: 5 });
    const c = addProduct(app.ctx, { stock: 1 });
    const lines = [a, b, c].map((p) => ({ productId: p.id, quantity: 2 }));
    assert.throws(() => reserve(app.ctx, lines), new RegExp(`not enough stock for ${c.id}`));
    assert.deepEqual([a, b, c].map((p) => getStock(app.ctx, p.id).reserved), [0, 0, 0]);
  });

  it('name the first short line', () => {
    const app = createTestApp();
    const ok = addProduct(app.ctx, { stock: 5 });
    const short1 = addProduct(app.ctx, { stock: 0 });
    const short2 = addProduct(app.ctx, { stock: 0 });
    const lines = [ok, short1, short2].map((p) => ({ productId: p.id, quantity: 1 }));
    assert.throws(() => reserve(app.ctx, lines), new RegExp(short1.id));
  });

  it('reserve every line when all are covered', () => {
    const app = createTestApp();
    const a = addProduct(app.ctx, { stock: 5 });
    const b = addProduct(app.ctx, { stock: 5 });
    reserve(app.ctx, [{ productId: a.id, quantity: 3 }, { productId: b.id, quantity: 5 }]);
    assert.deepEqual([a, b].map((p) => getStock(app.ctx, p.id).reserved), [3, 5]);
  });

  it('keep stock intact across a failed checkout', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx);
    const plenty = addProduct(app.ctx, { stock: 10 });
    const scarce = addProduct(app.ctx, { stock: 5 });
    app.call('POST', '/cart/items', { token, body: { productId: plenty.id, quantity: 2 } });
    app.call('POST', '/cart/items', { token, body: { productId: scarce.id, quantity: 2 } });
    app.ctx.store.stock.update(scarce.id, { onHand: 1 });
    assert.equal(app.call('POST', '/checkout', { token, body: { addressIndex: 0 } }).status, 409);
    assert.equal(getStock(app.ctx, plenty.id).reserved, 0);
  });
});
""")
t.couples('reserve-validation', 'textual', "Both change the line loop inside reserve() in inventory/stock.ts: one splits it into a check pass and a reserve pass, the other adds a quantity check at the top of the loop body.")

# ---------------------------------------------------------------------------
t = Task('reserve-validation', 'Reserving zero or negative quantities should be rejected', 'bug', 1, """
A caller that passed a negative quantity to the stock reservation code "released" stock by accident (the reserved counter went negative), and a fractional quantity corrupted the counters.

Reservation must refuse any quantity that is not a positive whole number, with a 400 error and the message "quantity must be a positive whole number", instead of applying it.
""")
t.ins_after('src/inventory/stock.ts', """export function reserve(ctx: AppContext, lines: CartLine[]): void {
  for (const line of lines) {
""", """    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw badRequest('quantity must be a positive whole number');
    }
""")
t.test('src/inventory/reserve-validation.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../lib/errors.ts';
import { addProduct, createTestApp } from '../lib/testing.ts';
import { getStock, reserve } from './stock.ts';

describe('reserve validation', () => {
  it('rejects zero, negative and fractional quantities', () => {
    const app = createTestApp();
    const product = addProduct(app.ctx, { stock: 10 });
    for (const quantity of [0, -3, 1.5]) {
      assert.throws(
        () => reserve(app.ctx, [{ productId: product.id, quantity }]),
        (e: unknown) => e instanceof AppError && e.status === 400 && e.message === 'quantity must be a positive whole number',
        `quantity ${quantity}`,
      );
    }
    assert.equal(getStock(app.ctx, product.id).reserved, 0);
  });

  it('still reserves positive whole quantities', () => {
    const app = createTestApp();
    const product = addProduct(app.ctx, { stock: 10 });
    reserve(app.ctx, [{ productId: product.id, quantity: 4 }]);
    assert.equal(getStock(app.ctx, product.id).reserved, 4);
  });
});
""")
t.couples('reserve-atomic', 'textual', "Both change the line loop inside reserve() in inventory/stock.ts: one splits it into a check pass and a reserve pass, the other adds a quantity check at the top of the loop body.")

# ---------------------------------------------------------------------------
t = Task('free-shipping', 'Free standard shipping on orders over $75', 'feature', 2, """
Marketing wants free standard shipping for orders whose goods come to $75.00 or more (price times quantity, before any discount and before tax). Express shipping is never free. When the threshold is met, the standard shipping charged on the order, and the standard quote returned by `POST /shipping/quote` for the cart, is 0; delivery time estimates do not change. The threshold is an exported constant, `FREE_SHIPPING_THRESHOLD` (in cents), in shipping/service.ts for now.
""")
t.rep('src/shipping/service.ts', "import { badRequest, conflict } from '../lib/errors.ts';", "import { badRequest, conflict } from '../lib/errors.ts';\nimport { sumCents } from '../lib/money.ts';")
t.rep('src/shipping/service.ts', "/** Weight of an order's lines, from current catalog data. */", "/** Standard shipping is free once the goods in an order come to this many cents. */\nexport const FREE_SHIPPING_THRESHOLD = 7500;\n\n/** Weight of an order's lines, from current catalog data. */")
t.rep('src/shipping/service.ts', "  return quoteShipping(order.shippingAddress, orderWeight(ctx, order), method, ctx.config.defaultCountry);\n",
      "  const quote = quoteShipping(order.shippingAddress, orderWeight(ctx, order), method, ctx.config.defaultCountry);\n  const goods = sumCents(order.lines.map((line) => line.unitPrice * line.quantity));\n  return method === 'standard' && goods >= FREE_SHIPPING_THRESHOLD ? { ...quote, cost: 0 } : quote;\n")
t.rep('README.md', "- Standard shipping is charged by destination zone and weight; express costs double.\n", "- Standard shipping is charged by destination zone and weight and is free for orders with $75 or more of goods; express costs double and is never free.\n")
t.test('src/shipping/free-shipping.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProduct, createTestApp, placeOrder, signUp, US_ADDRESS } from '../lib/testing.ts';
import type { ShippingQuote } from '../types.ts';
import { FREE_SHIPPING_THRESHOLD } from './service.ts';

function quoteFor(price: number, quantity: number, method: 'standard' | 'express' = 'standard') {
  const app = createTestApp();
  const { token } = signUp(app.ctx, 'a@example.com', { address: US_ADDRESS });
  const product = addProduct(app.ctx, { price });
  app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity } });
  return app.call('POST', '/shipping/quote', { token, body: { addressIndex: 0, method } }).body as ShippingQuote;
}

describe('free shipping', () => {
  it('has a $75 threshold', () => {
    assert.equal(FREE_SHIPPING_THRESHOLD, 7500);
  });

  it('makes standard shipping free at the threshold', () => {
    assert.equal(quoteFor(2500, 3).cost, 0);
    assert.equal(quoteFor(7499, 1).cost, 500);
    assert.equal(quoteFor(7500, 1).cost, 0);
  });

  it('never makes express shipping free', () => {
    assert.deepEqual(quoteFor(10000, 1, 'express'), { method: 'express', cost: 1000, etaDays: 2 });
  });

  it('applies to the shipping charged at checkout', () => {
    const app = createTestApp();
    assert.equal(placeOrder(app, { price: 8000, address: US_ADDRESS }).order.shippingCost, 0);
    assert.equal(placeOrder(app, { email: 'b@example.com', price: 7000, address: US_ADDRESS }).order.shippingCost, 500);
  });
});
""")

# ---------------------------------------------------------------------------
t = Task('session-sliding', 'Active customers are logged out in the middle of a session', 'feature', 2, """
Sessions expire a fixed time after login even if the customer is busy shopping, which logs people out halfway through checkout.

Make the expiry sliding: every authenticated request moves the session's expiry out to a full session lifetime from now. A session that has already expired stays rejected and is not revived by later requests.
""")
t.rep('src/auth/sessions.ts', "export function destroySession(", """/** Push a live session's expiry out to a full lifetime from now. */
export function touchSession(ctx: AppContext, session: Session): Session {
  const expiresAt = new Date(ctx.clock.now().getTime() + ctx.config.sessionTtlSeconds * 1000).toISOString();
  return ctx.store.sessions.update(session.id, { expiresAt });
}

export function destroySession(""")
t.rep('src/auth/guard.ts', "import { findSession } from './sessions.ts';", "import { findSession, touchSession } from './sessions.ts';")
t.rep('src/auth/guard.ts', "  if (!session) return null;\n", "  if (!session) return null;\n  touchSession(ctx, session);\n")
t.rep('README.md', "- A session lasts `SESSION_TTL_SECONDS` from login.\n", "- A session lasts `SESSION_TTL_SECONDS` from login and is extended every time it is used.\n")
t.test('src/auth/sliding-sessions.test.ts', """
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, signUp } from '../lib/testing.ts';

const MINUTE = 60_000;

function setup() {
  const app = createTestApp();
  app.ctx.config.sessionTtlSeconds = 3600;
  const { token } = signUp(app.ctx);
  const me = () => app.call('GET', '/users/me', { token }).status;
  return { app, token, me };
}

describe('sliding sessions', () => {
  it('stay alive while the customer keeps using them', () => {
    const { app, me } = setup();
    app.clock.advance(50 * MINUTE);
    assert.equal(me(), 200);
    app.clock.advance(50 * MINUTE);
    assert.equal(me(), 200, 'the first request moved the expiry out');
    app.clock.advance(61 * MINUTE);
    assert.equal(me(), 401, 'but an idle hour still expires it');
  });

  it('record the new expiry', () => {
    const { app, token, me } = setup();
    app.clock.advance(10 * MINUTE);
    me();
    assert.equal(app.ctx.store.sessions.require(token).expiresAt, '2026-09-15T13:10:00.000Z');
  });

  it('do not revive an expired session', () => {
    const { app, token, me } = setup();
    app.clock.advance(61 * MINUTE);
    assert.equal(me(), 401);
    assert.equal(app.ctx.store.sessions.require(token).expiresAt, '2026-09-15T13:00:00.000Z', 'rejected request left the expiry alone');
    assert.equal(me(), 401);
  });
});
""")

