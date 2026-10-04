import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase, runMigrations } from '../db/migrate.ts';
import { migrations } from '../db/migrations/index.ts';
import { Store } from '../db/store.ts';
import { CA_ADDRESS, addProduct, createTestApp, errorMessage, signUp } from '../lib/testing.ts';
import type { Order } from '../types.ts';

type NotedOrder = Order & { note: string };

function checkoutWith(note?: unknown) {
  const app = createTestApp();
  const { token } = signUp(app.ctx, 'note@example.com');
  const product = addProduct(app.ctx);
  app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 1 } });
  const body: Record<string, unknown> = { addressIndex: 0 };
  if (note !== undefined) body.note = note;
  const res = app.call('POST', '/checkout', { token, body });
  return { app, token, res };
}

describe('order delivery notes', () => {
  it('stores the note on the order, trimmed', () => {
    const { res } = checkoutWith('  leave with the concierge  ');
    assert.equal(res.status, 201);
    assert.equal((res.body as NotedOrder).note, 'leave with the concierge');
  });

  it('defaults to an empty string when no note is given', () => {
    const { res } = checkoutWith();
    assert.equal(res.status, 201);
    assert.equal((res.body as NotedOrder).note, '');
  });

  it('stores a blank note as an empty string', () => {
    const { res } = checkoutWith('   ');
    assert.equal(res.status, 201);
    assert.equal((res.body as NotedOrder).note, '');
  });

  it('accepts a note of exactly 200 characters', () => {
    const note = 'a'.repeat(200);
    const { res } = checkoutWith(note);
    assert.equal(res.status, 201);
    assert.equal((res.body as NotedOrder).note, note);
  });

  it('rejects a note longer than 200 characters with a 400', () => {
    const { res, app, token } = checkoutWith('a'.repeat(201));
    assert.equal(res.status, 400);
    assert.equal(errorMessage(res), 'note must be at most 200 characters');
    assert.deepEqual(app.call('GET', '/orders', { token }).body, []);
  });

  it('returns the note when the order is fetched or listed', () => {
    const { res, app, token } = checkoutWith('ring twice');
    const order = res.body as NotedOrder;
    assert.equal(order.note, 'ring twice');
    const fetched = app.call('GET', `/orders/${order.id}`, { token }).body as NotedOrder;
    assert.equal(fetched.note, 'ring twice');
    const listed = app.call('GET', '/orders', { token }).body as NotedOrder[];
    assert.equal(listed.find((o) => o.id === order.id)?.note, 'ring twice');
  });

  it('keeps the note after the order is cancelled', () => {
    const { res, app, token } = checkoutWith('side door');
    const order = res.body as NotedOrder;
    const cancelled = app.call('POST', `/orders/${order.id}/cancel`, { token }).body as NotedOrder;
    assert.equal(cancelled.note, 'side door');
  });
});

describe('order note migration', () => {
  it('gives existing orders an empty note', () => {
    const store = new Store();
    runMigrations(store, migrations.filter((m) => m.version <= 5));
    store.orders.insert({
      id: 'ord_old',
      number: 'BS-OLD',
      userId: 'usr_old',
      status: 'paid',
      lines: [],
      subtotal: 0,
      discount: 0,
      tax: 0,
      total: 0,
      couponCode: null,
      shippingAddress: CA_ADDRESS,
      invoiceId: null,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    } as unknown as Order);
    const ran = runMigrations(store);
    assert.ok(ran.length >= 1);
    assert.ok(ran.every((v) => v > 5));
    assert.equal((store.orders.require('ord_old') as NotedOrder).note, '');
  });

  it('registers the new migration after the existing ones', () => {
    assert.ok(migrations.length > 5);
    assert.ok(migrations.at(-1)!.version > 5);
    assert.equal(openDatabase().schemaVersion, migrations.at(-1)!.version);
  });
});
