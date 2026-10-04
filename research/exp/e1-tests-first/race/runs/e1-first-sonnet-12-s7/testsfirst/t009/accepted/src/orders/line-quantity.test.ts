import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import { fakeClock } from '../lib/clock.ts';
import { getCart } from '../cart/service.ts';
import { getStock } from '../inventory/stock.ts';
import { createMemoryMailer } from '../notifications/queue.ts';
import { addProduct, errorMessage, signUp } from '../lib/testing.ts';
import type { TestApp } from '../lib/testing.ts';

function appWith(env: Record<string, string> = {}): TestApp {
  const clock = fakeClock();
  const mailer = createMemoryMailer();
  const app = createApp({ clock, mailer, config: loadConfig({ PASSWORD_COST: '16', ...env }) });
  return {
    ...app,
    clock,
    mailer,
    call: (method, path, options = {}) =>
      app.handle({
        method,
        path,
        body: options.body,
        query: options.query,
        headers: options.token ? { authorization: `Bearer ${options.token}` } : {},
      }),
  };
}

let emailCounter = 0;

/** Put the given quantities of new products straight into the cart (bypassing cart routes) and check out. */
function checkoutWith(app: TestApp, quantities: number[]) {
  emailCounter += 1;
  const { user, token } = signUp(app.ctx, `limit${emailCounter}@example.com`);
  const products = quantities.map(() => addProduct(app.ctx, { stock: 100000 }));
  app.ctx.store.carts.insert({
    id: user.id,
    lines: products.map((p, i) => ({ productId: p.id, quantity: quantities[i] })),
    updatedAt: app.ctx.clock.now().toISOString(),
  });
  const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
  return { user, products, res };
}

function maxLineQuantity(env: Record<string, string>): unknown {
  return (loadConfig(env) as unknown as { maxLineQuantity: unknown }).maxLineQuantity;
}

describe('per-line quantity limit', () => {
  it('defaults maxLineQuantity to 10 and reads MAX_LINE_QUANTITY', () => {
    assert.equal(maxLineQuantity({}), 10);
    assert.equal(maxLineQuantity({ MAX_LINE_QUANTITY: '3' }), 3);
  });

  it('allows exactly the default limit of 10 units', () => {
    const { res } = checkoutWith(appWith(), [10]);
    assert.equal(res.status, 201);
  });

  it('rejects 11 units of one product with a 400 and the limit message', () => {
    const { res, products } = checkoutWith(appWith(), [11]);
    assert.equal(res.status, 400);
    assert.equal(errorMessage(res), `at most 10 units of ${products[0].name} per order`);
  });

  it('names the offending product when another line is fine', () => {
    const { res, products } = checkoutWith(appWith(), [2, 50]);
    assert.equal(res.status, 400);
    assert.equal(errorMessage(res), `at most 10 units of ${products[1].name} per order`);
  });

  it('does not add quantities across different products', () => {
    const { res } = checkoutWith(appWith(), [10, 10, 10]);
    assert.equal(res.status, 201);
  });

  it('honours MAX_LINE_QUANTITY', () => {
    const app = appWith({ MAX_LINE_QUANTITY: '3' });
    assert.equal(checkoutWith(app, [3]).res.status, 201);
    const bad = checkoutWith(app, [4]);
    assert.equal(bad.res.status, 400);
    assert.equal(errorMessage(bad.res), `at most 3 units of ${bad.products[0].name} per order`);
  });

  it('reserves no stock, creates no invoice and keeps the cart when refused', () => {
    const app = appWith();
    const { res, products, user } = checkoutWith(app, [11]);
    assert.equal(res.status, 400);
    assert.equal(getStock(app.ctx, products[0].id).reserved, 0);
    assert.equal(app.ctx.store.invoices.all().length, 0);
    assert.equal(getCart(app.ctx, user.id).lines.length, 1);
  });
});
