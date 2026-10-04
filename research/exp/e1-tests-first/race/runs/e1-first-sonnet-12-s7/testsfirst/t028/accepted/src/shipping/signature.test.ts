import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../config.ts';
import { createTestApp, placeOrder, signUp } from '../lib/testing.ts';
import type { Shipment } from '../types.ts';

type SigShipment = Shipment & { signatureRequired: boolean };

function shipAndFetch(app: ReturnType<typeof createTestApp>, orderId: string, token: string): SigShipment {
  const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
  const shipped = app.call('POST', `/orders/${orderId}/ship`, { token: admin.token, body: { trackingNumber: 'TRK-1' } });
  assert.equal(shipped.status, 200);
  const res = app.call('GET', `/orders/${orderId}/shipment`, { token });
  assert.equal(res.status, 200);
  return res.body as SigShipment;
}

function setThreshold(app: ReturnType<typeof createTestApp>, cents: number): void {
  (app.ctx.config as unknown as { signatureThreshold: number }).signatureThreshold = cents;
}

describe('signature threshold config', () => {
  it('defaults to 25000 cents', () => {
    assert.equal((loadConfig() as unknown as { signatureThreshold: number }).signatureThreshold, 25000);
  });

  it('is overridden by SIGNATURE_THRESHOLD', () => {
    const config = loadConfig({ SIGNATURE_THRESHOLD: '10000' }) as unknown as { signatureThreshold: number };
    assert.equal(config.signatureThreshold, 10000);
  });
});

describe('signatureRequired on shipments', () => {
  it('is true for a high-value order', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app, { price: 30000 });
    assert.ok(order.total >= 25000);
    assert.equal(shipAndFetch(app, order.id, token).signatureRequired, true);
  });

  it('is false for a low-value order', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app, { price: 2000 });
    assert.equal(shipAndFetch(app, order.id, token).signatureRequired, false);
  });

  it('is stored on the shipment record', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app, { price: 30000 });
    shipAndFetch(app, order.id, token);
    const stored = app.ctx.store.shipments.findOne((s) => s.orderId === order.id) as unknown as SigShipment;
    assert.equal(stored.signatureRequired, true);
  });

  it('is true when the order total equals the threshold exactly', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app, { price: 5000 });
    setThreshold(app, order.total);
    assert.equal(shipAndFetch(app, order.id, token).signatureRequired, true);
  });

  it('is false when the order total is one cent below the threshold', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app, { price: 5000 });
    setThreshold(app, order.total + 1);
    assert.equal(shipAndFetch(app, order.id, token).signatureRequired, false);
  });

  it('follows a lowered threshold', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app, { price: 2000 });
    setThreshold(app, 1000);
    assert.equal(shipAndFetch(app, order.id, token).signatureRequired, true);
  });
});
