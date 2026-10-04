import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase, runMigrations } from '../db/migrate.ts';
import { migrations } from '../db/migrations/index.ts';
import { Store } from '../db/store.ts';
import { CA_ADDRESS, createTestApp, placeOrder, signUp } from '../lib/testing.ts';
import type { Order, Shipment } from '../types.ts';

function shipOrder(app: ReturnType<typeof createTestApp>, orderId: string, trackingNumber: string) {
  const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
  return app.call('POST', `/orders/${orderId}/ship`, { token: admin.token, body: { trackingNumber } });
}

describe('tracking numbers on shipments', () => {
  it('returns the updated order without a tracking number', () => {
    const app = createTestApp();
    const { order } = placeOrder(app);
    const res = shipOrder(app, order.id, 'TRK-5');
    assert.equal(res.status, 200);
    assert.equal((res.body as Order).status, 'shipped');
    assert.equal('trackingNumber' in (res.body as object), false);
  });

  it('stores the tracking number on the shipment and serves it from GET /orders/:id/shipment', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app);
    shipOrder(app, order.id, 'TRK-5');
    const res = app.call('GET', `/orders/${order.id}/shipment`, { token });
    assert.equal(res.status, 200);
    assert.equal((res.body as Shipment & { trackingNumber: string }).trackingNumber, 'TRK-5');
    const stored = app.ctx.store.shipments.findOne((s) => s.orderId === order.id) as unknown as { trackingNumber: string };
    assert.equal(stored.trackingNumber, 'TRK-5');
  });

  it('does not keep a tracking number on stored orders', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app);
    assert.equal('trackingNumber' in app.ctx.store.orders.require(order.id), false);
    shipOrder(app, order.id, 'TRK-5');
    assert.equal('trackingNumber' in app.ctx.store.orders.require(order.id), false);
    const fetched = app.call('GET', `/orders/${order.id}`, { token });
    assert.equal('trackingNumber' in (fetched.body as object), false);
  });
});

describe('tracking number migration', () => {
  it('copies the order tracking number to its existing shipment and drops the order column', () => {
    const store = new Store();
    runMigrations(store, migrations.filter((m) => m.version <= 5));
    const base = {
      number: 'N',
      userId: 'usr_x',
      status: 'shipped',
      lines: [],
      subtotal: 0,
      discount: 0,
      tax: 0,
      total: 0,
      couponCode: null,
      shippingAddress: CA_ADDRESS,
      invoiceId: null,
      createdAt: 'now',
      updatedAt: 'now',
    };
    store.orders.insert({ ...base, id: 'ord_a', trackingNumber: 'TRK-OLD' } as unknown as Order);
    store.shipments.insert({
      id: 'shp_a',
      orderId: 'ord_a',
      method: 'standard',
      cost: 500,
      status: 'shipped',
      shippedAt: 'now',
    });

    const ran = runMigrations(store);
    assert.ok(ran.length >= 1);
    assert.ok(Math.min(...ran) > 5);
    assert.equal((store.shipments.require('shp_a') as unknown as { trackingNumber: string }).trackingNumber, 'TRK-OLD');
    assert.equal('trackingNumber' in store.orders.require('ord_a'), false);

    store.orders.insert({ ...base, id: 'ord_b' } as unknown as Order);
    assert.equal('trackingNumber' in store.orders.require('ord_b'), false);
  });

  it('leaves a fully migrated database without an order tracking column', () => {
    const store = openDatabase();
    store.orders.insert({ id: 'ord_c' } as unknown as Order);
    assert.equal('trackingNumber' in store.orders.require('ord_c'), false);
  });
});
