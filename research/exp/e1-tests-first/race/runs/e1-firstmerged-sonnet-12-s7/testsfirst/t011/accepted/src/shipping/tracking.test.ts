import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runMigrations } from '../db/migrate.ts';
import { migrations } from '../db/migrations/index.ts';
import { Store } from '../db/store.ts';
import { createTestApp, placeOrder, signUp } from '../lib/testing.ts';
import type { Order, Shipment } from '../types.ts';
import { getShipment, markShipped } from './service.ts';

function ship(app: ReturnType<typeof createTestApp>, orderId: string, trackingNumber: string) {
  const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
  return app.call('POST', `/orders/${orderId}/ship`, { token: admin.token, body: { trackingNumber } });
}

describe('tracking numbers on shipments', () => {
  it('returns the updated order without a tracking number from POST /orders/:id/ship', () => {
    const app = createTestApp();
    const { order } = placeOrder(app);
    const res = ship(app, order.id, 'TRK-100');
    assert.equal(res.status, 200);
    const body = res.body as Order;
    assert.equal(body.status, 'shipped');
    assert.equal(body.id, order.id);
    assert.ok(!('trackingNumber' in body));
  });

  it('serves the tracking number from GET /orders/:id/shipment', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app);
    ship(app, order.id, 'TRK-200');
    const res = app.call('GET', `/orders/${order.id}/shipment`, { token });
    assert.equal(res.status, 200);
    const shipment = res.body as Shipment;
    assert.equal(shipment.trackingNumber, 'TRK-200');
    assert.equal(shipment.orderId, order.id);
    assert.equal(shipment.status, 'shipped');
  });

  it('stores the tracking number on the shipment and not on the order', () => {
    const app = createTestApp();
    const { order } = placeOrder(app);
    markShipped(app.ctx, order.id, 'TRK-300');
    assert.equal(getShipment(app.ctx, order.id)?.trackingNumber, 'TRK-300');
    assert.ok(!('trackingNumber' in app.ctx.store.orders.require(order.id)));
  });

  it('does not put a tracking number on newly placed orders', () => {
    const app = createTestApp();
    const { order } = placeOrder(app);
    assert.ok(!('trackingNumber' in order));
    assert.ok(!('trackingNumber' in app.ctx.store.orders.require(order.id)));
  });

  it('still requires a tracking number to ship', () => {
    const app = createTestApp();
    const { order } = placeOrder(app);
    assert.throws(() => markShipped(app.ctx, order.id, ''), /tracking number is required/);
  });
});

describe('tracking number migration', () => {
  it('copies order tracking numbers to existing shipments and drops the order column', () => {
    const store = new Store();
    runMigrations(store, migrations.filter((m) => m.version <= 5));
    assert.equal(store.schemaVersion, 5);

    const orderRow = (id: string, trackingNumber: string | null, status: string) =>
      ({
        id,
        number: `N-${id}`,
        userId: 'usr_0001',
        status,
        lines: [],
        subtotal: 0,
        discount: 0,
        tax: 0,
        shippingCost: 500,
        total: 0,
        couponCode: null,
        shippingAddress: {},
        invoiceId: null,
        trackingNumber,
        createdAt: 'x',
        updatedAt: 'x',
      }) as unknown as Order;
    store.orders.insert(orderRow('ord_a', 'TRK-A', 'shipped'));
    store.orders.insert(orderRow('ord_b', 'TRK-B', 'delivered'));
    const shipmentRow = (id: string, orderId: string) =>
      ({ id, orderId, method: 'standard', cost: 500, status: 'shipped', shippedAt: 'x' }) as Shipment;
    store.shipments.insert(shipmentRow('shp_a', 'ord_a'));
    store.shipments.insert(shipmentRow('shp_b', 'ord_b'));

    const ran = runMigrations(store);
    assert.equal(ran.length, 1);
    assert.ok(ran[0] > 5);
    assert.equal(store.schemaVersion, ran[0]);

    assert.equal(store.shipments.require('shp_a').trackingNumber, 'TRK-A');
    assert.equal(store.shipments.require('shp_b').trackingNumber, 'TRK-B');
    assert.ok(!('trackingNumber' in store.orders.require('ord_a')));
    assert.ok(!('trackingNumber' in store.orders.require('ord_b')));
    assert.equal(store.shipments.require('shp_a').orderId, 'ord_a');
    assert.equal(store.orders.require('ord_a').status, 'shipped');
  });
});
