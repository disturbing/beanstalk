import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runMigrations } from '../db/migrate.ts';
import { migrations } from '../db/migrations/index.ts';
import { Store } from '../db/store.ts';
import { addProduct, createTestApp, errorMessage, signUp } from '../lib/testing.ts';
import type { TestApp } from '../lib/testing.ts';
import type { Order } from '../types.ts';

type NotedOrder = Order & { note: string };

function checkoutWith(app: TestApp, extra: Record<string, unknown>, email = 'buyer@example.com') {
  const { token } = signUp(app.ctx, email);
  const product = addProduct(app.ctx);
  app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 1 } });
  const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0, ...extra } });
  return { token, res };
}

describe('order delivery notes', () => {
  it('stores the note on the order and returns it from checkout, get and list', () => {
    const app = createTestApp();
    const { token, res } = checkoutWith(app, { note: 'leave with the concierge' });
    assert.equal(res.status, 201);
    const order = res.body as NotedOrder;
    assert.equal(order.note, 'leave with the concierge');
    const got = app.call('GET', `/orders/${order.id}`, { token }).body as NotedOrder;
    assert.equal(got.note, 'leave with the concierge');
    const list = app.call('GET', '/orders', { token }).body as { items?: NotedOrder[] } | NotedOrder[];
    const items = Array.isArray(list) ? list : list.items!;
    assert.equal(items[0].note, 'leave with the concierge');
    assert.equal((app.ctx.store.orders.require(order.id) as NotedOrder).note, 'leave with the concierge');
  });

  it('trims the note', () => {
    const app = createTestApp();
    const { res } = checkoutWith(app, { note: '  ring twice \n' });
    assert.equal(res.status, 201);
    assert.equal((res.body as NotedOrder).note, 'ring twice');
  });

  it('uses an empty string when the note is missing or blank', () => {
    const app = createTestApp();
    const none = checkoutWith(app, {}, 'a@example.com');
    assert.equal(none.res.status, 201);
    assert.equal((none.res.body as NotedOrder).note, '');
    const blank = checkoutWith(app, { note: '   ' }, 'b@example.com');
    assert.equal(blank.res.status, 201);
    assert.equal((blank.res.body as NotedOrder).note, '');
  });

  it('accepts a note of exactly 200 characters', () => {
    const app = createTestApp();
    const note = 'x'.repeat(200);
    const { res } = checkoutWith(app, { note });
    assert.equal(res.status, 201);
    assert.equal((res.body as NotedOrder).note, note);
  });

  it('measures the limit after trimming', () => {
    const app = createTestApp();
    const note = 'x'.repeat(200);
    const { res } = checkoutWith(app, { note: `  ${note}  ` });
    assert.equal(res.status, 201);
    assert.equal((res.body as NotedOrder).note, note);
  });

  it('rejects a note longer than 200 characters with a 400 and creates no order', () => {
    const app = createTestApp();
    const { res } = checkoutWith(app, { note: 'x'.repeat(201) });
    assert.equal(res.status, 400);
    assert.equal(errorMessage(res), 'note must be at most 200 characters');
    assert.equal(app.ctx.store.orders.all().length, 0);
  });

  it('gives orders that already exist an empty note via a new numbered migration', () => {
    const latestBefore = 5;
    const added = migrations.filter((m) => m.version > latestBefore);
    assert.ok(added.length >= 1, 'a new migration is registered');

    const store = new Store();
    runMigrations(store, migrations.filter((m) => m.version <= latestBefore));
    const app = createTestApp();
    const template = checkoutWith(app, {}).res.body as NotedOrder;
    const legacy: Partial<NotedOrder> = { ...template, id: 'legacy-order' };
    delete legacy.note;
    store.orders.insert(legacy as Order);

    const ran = runMigrations(store);
    assert.deepEqual(ran, added.map((m) => m.version));
    assert.equal((store.orders.require('legacy-order') as NotedOrder).note, '');
  });
});
