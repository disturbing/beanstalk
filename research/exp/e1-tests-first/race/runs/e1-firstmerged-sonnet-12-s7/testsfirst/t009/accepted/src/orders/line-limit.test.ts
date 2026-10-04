import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import { getStock } from '../inventory/stock.ts';
import { fakeClock } from '../lib/clock.ts';
import { addProduct, errorMessage, signUp } from '../lib/testing.ts';
import { createMemoryMailer } from '../notifications/queue.ts';
import type { Order } from '../types.ts';

function appWith(env: Record<string, string> = {}) {
  const app = createApp({
    clock: fakeClock(),
    mailer: createMemoryMailer(),
    config: loadConfig({ PASSWORD_COST: '16', ...env }),
  });
  return {
    app,
    checkoutWith(lines: Array<{ quantity: number; name?: string }>) {
      const { user, token } = signUp(app.ctx);
      const products = lines.map((l) => addProduct(app.ctx, { stock: 1000, ...(l.name ? { name: l.name } : {}) }));
      // Put the lines straight into the cart so the test does not depend on where the limit is enforced.
      app.ctx.store.carts.insert({
        id: user.id,
        lines: products.map((p, i) => ({ productId: p.id, quantity: lines[i].quantity })),
        updatedAt: app.ctx.clock.now().toISOString(),
      });
      const res = app.handle({
        method: 'POST',
        path: '/checkout',
        body: { addressIndex: 0 },
        headers: { authorization: `Bearer ${token}` },
      });
      return { res, products, user };
    },
  };
}

describe('per-line quantity limit at checkout', () => {
  it('defaults to 10 units per product', () => {
    assert.equal(loadConfig({}).maxLineQuantity, 10);
  });

  it('reads MAX_LINE_QUANTITY from the environment', () => {
    assert.equal(loadConfig({ MAX_LINE_QUANTITY: '3' }).maxLineQuantity, 3);
  });

  it('allows exactly the default limit', () => {
    const { checkoutWith } = appWith();
    const { res } = checkoutWith([{ quantity: 10 }]);
    assert.equal(res.status, 201);
    assert.equal((res.body as Order).lines[0].quantity, 10);
  });

  it('rejects one unit over the default limit with a 400 and the message', () => {
    const { checkoutWith } = appWith();
    const { res } = checkoutWith([{ quantity: 11, name: 'Magic Beans' }]);
    assert.equal(res.status, 400);
    assert.equal(errorMessage(res), 'at most 10 units of Magic Beans per order');
  });

  it('names the offending product when only one line breaks the limit', () => {
    const { checkoutWith } = appWith();
    const { res } = checkoutWith([
      { quantity: 2, name: 'Fine Item' },
      { quantity: 50, name: 'Bulk Item' },
    ]);
    assert.equal(res.status, 400);
    assert.equal(errorMessage(res), 'at most 10 units of Bulk Item per order');
  });

  it('applies the limit per product, not across the whole order', () => {
    const { checkoutWith } = appWith();
    const { res } = checkoutWith([{ quantity: 10 }, { quantity: 10 }, { quantity: 10 }]);
    assert.equal(res.status, 201);
  });

  it('uses the configured limit', () => {
    assert.equal(appWith({ MAX_LINE_QUANTITY: '3' }).checkoutWith([{ quantity: 3 }]).res.status, 201);
    const { res } = appWith({ MAX_LINE_QUANTITY: '3' }).checkoutWith([{ quantity: 4, name: 'Gizmo' }]);
    assert.equal(res.status, 400);
    assert.equal(errorMessage(res), 'at most 3 units of Gizmo per order');
  });

  it('a larger configured limit lets bigger lines through', () => {
    const { res } = appWith({ MAX_LINE_QUANTITY: '100' }).checkoutWith([{ quantity: 100 }]);
    assert.equal(res.status, 201);
  });

  it('reserves no stock and creates no invoice or order when rejected', () => {
    const { app, checkoutWith } = appWith();
    const { res, products, user } = checkoutWith([{ quantity: 2 }, { quantity: 11 }]);
    assert.equal(res.status, 400);
    for (const p of products) assert.equal(getStock(app.ctx, p.id).reserved, 0);
    assert.equal(app.ctx.store.invoices.all().length, 0);
    assert.equal(app.ctx.store.orders.all().length, 0);
    assert.equal(app.ctx.store.carts.get(user.id)?.lines.length, 2);
  });
});
