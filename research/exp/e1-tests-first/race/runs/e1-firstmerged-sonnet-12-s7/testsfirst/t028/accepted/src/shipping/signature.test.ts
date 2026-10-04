import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import { fakeClock } from '../lib/clock.ts';
import { createMemoryMailer } from '../notifications/queue.ts';
import { createTestApp, placeOrder, signUp } from '../lib/testing.ts';
import type { TestApp } from '../lib/testing.ts';

type ShipmentBody = { signatureRequired: boolean };

/** Place an order whose total is forced to `total`, ship it and return the shipment as the endpoint shows it. */
function shipWithTotal(app: TestApp, total: number) {
  const { order, token } = placeOrder(app);
  app.ctx.store.orders.update(order.id, { total });
  const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
  const ship = app.call('POST', `/orders/${order.id}/ship`, { token: admin.token, body: { trackingNumber: 'TRK-1' } });
  assert.equal(ship.status, 200);
  const res = app.call('GET', `/orders/${order.id}/shipment`, { token });
  assert.equal(res.status, 200);
  return res.body as ShipmentBody;
}

/** A test app built from a config loaded with the given environment overrides. */
function appWithEnv(env: Record<string, string>): TestApp {
  const base = createTestApp();
  const clock = fakeClock();
  const mailer = createMemoryMailer();
  const config = loadConfig({ PASSWORD_COST: '16', ...env });
  const app = createApp({ clock, mailer, config });
  return {
    ...base,
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

describe('signature for high-value deliveries', () => {
  it('defaults the threshold to 25000 cents', () => {
    assert.equal((loadConfig({}) as unknown as { signatureThreshold: number }).signatureThreshold, 25000);
  });

  it('reads the threshold from SIGNATURE_THRESHOLD', () => {
    const config = loadConfig({ SIGNATURE_THRESHOLD: '10000' }) as unknown as { signatureThreshold: number };
    assert.equal(config.signatureThreshold, 10000);
  });

  it('requires a signature when the total is exactly the threshold', () => {
    assert.equal(shipWithTotal(createTestApp(), 25000).signatureRequired, true);
  });

  it('requires a signature above the threshold', () => {
    assert.equal(shipWithTotal(createTestApp(), 80000).signatureRequired, true);
  });

  it('does not require a signature just below the threshold', () => {
    assert.equal(shipWithTotal(createTestApp(), 24999).signatureRequired, false);
  });

  it('records the flag on the stored shipment', () => {
    const app = createTestApp();
    const { order } = placeOrder(app);
    app.ctx.store.orders.update(order.id, { total: 30000 });
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    app.call('POST', `/orders/${order.id}/ship`, { token: admin.token, body: { trackingNumber: 'TRK-2' } });
    const shipment = app.ctx.store.shipments.findOne((s) => s.orderId === order.id) as unknown as ShipmentBody;
    assert.equal(shipment.signatureRequired, true);
  });

  it('honours an overridden threshold', () => {
    assert.equal(shipWithTotal(appWithEnv({ SIGNATURE_THRESHOLD: '10000' }), 10000).signatureRequired, true);
    assert.equal(shipWithTotal(appWithEnv({ SIGNATURE_THRESHOLD: '10000' }), 9999).signatureRequired, false);
    assert.equal(shipWithTotal(appWithEnv({ SIGNATURE_THRESHOLD: '90000' }), 30000).signatureRequired, false);
  });
});
