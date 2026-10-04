import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, placeOrder, signUp } from '../lib/testing.ts';
import { markShipped } from './service.ts';

describe('order shipped email tracking number', () => {
  it('adds the tracking number on a line after the existing sentence', () => {
    const app = createTestApp();
    const { order, user } = placeOrder(app);
    markShipped(app.ctx, order.id, 'TRK-9981');
    const mail = app.mailer.sent.at(-1)!;
    assert.equal(mail.to, user.email);
    assert.match(mail.subject, /has shipped/);
    const lines = mail.body.split('\n');
    assert.equal(lines[0], `Your order ${order.number} is on its way.`);
    assert.equal(lines.at(-1)!.trim(), 'Tracking number: TRK-9981');
  });

  it('uses the number given when shipping through the route', () => {
    const app = createTestApp();
    const { order } = placeOrder(app);
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    app.call('POST', `/orders/${order.id}/ship`, { token: admin.token, body: { trackingNumber: 'ZX-42' } });
    assert.match(app.mailer.sent.at(-1)!.body, /^Tracking number: ZX-42$/m);
  });
});
