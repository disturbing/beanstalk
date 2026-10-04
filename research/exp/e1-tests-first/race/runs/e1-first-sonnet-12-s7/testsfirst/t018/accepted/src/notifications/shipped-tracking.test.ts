import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, placeOrder, signUp } from '../lib/testing.ts';

describe('order shipped email', () => {
  it('includes the tracking number after the existing sentence', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app);
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    const res = app.call('POST', `/orders/${order.id}/ship`, { token: admin.token, body: { trackingNumber: 'TRK-4242' } });
    assert.equal(res.status, 200);
    void token;

    const mail = app.mailer.sent.filter((m) => /has shipped/.test(m.subject)).at(-1)!;
    assert.ok(mail, 'a shipped email was sent');
    const lines = mail.body.split('\n');
    assert.equal(lines[0], `Your order ${order.number} is on its way.`);
    assert.equal(lines[1], 'Tracking number: TRK-4242');
  });

  it('uses the tracking number recorded for that order', () => {
    const app = createTestApp();
    const first = placeOrder(app, { email: 'one@example.com' });
    const second = placeOrder(app, { email: 'two@example.com' });
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    app.call('POST', `/orders/${first.order.id}/ship`, { token: admin.token, body: { trackingNumber: 'AAA-1' } });
    app.call('POST', `/orders/${second.order.id}/ship`, { token: admin.token, body: { trackingNumber: 'BBB-2' } });

    const bodies = app.mailer.sent.filter((m) => /has shipped/.test(m.subject)).map((m) => m.body);
    assert.equal(bodies.length, 2);
    assert.match(bodies[0], /^Tracking number: AAA-1$/m);
    assert.match(bodies[1], /^Tracking number: BBB-2$/m);
    assert.doesNotMatch(bodies[1], /AAA-1/);
  });
});
