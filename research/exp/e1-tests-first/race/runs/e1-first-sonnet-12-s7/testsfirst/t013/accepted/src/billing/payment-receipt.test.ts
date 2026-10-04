import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, placeOrder, signUp } from '../lib/testing.ts';
import type { Notification } from '../types.ts';
import { markPaid } from './service.ts';

describe('payment receipt', () => {
  it('emails the customer a receipt when the invoice is marked paid', () => {
    const app = createTestApp();
    const { order, user } = placeOrder(app, { email: 'payer@example.com' });
    const before = app.mailer.sent.length;
    markPaid(app.ctx, order.invoiceId!);
    const receipts = app.mailer.sent.slice(before);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].to, user.email);
    assert.equal(receipts[0].subject, `Payment received for order ${order.number}`);
    assert.equal(receipts[0].body, `We have received your payment for order ${order.number}. Thank you!`);
  });

  it('lists the receipt as a payment_received notification', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app);
    markPaid(app.ctx, order.invoiceId!);
    const list = app.call('GET', '/notifications', { token }).body as Notification[];
    const receipt = list.find((n) => (n.kind as string) === 'payment_received');
    assert.ok(receipt, 'expected a payment_received notification');
    assert.equal(receipt.subject, `Payment received for order ${order.number}`);
    assert.equal(receipt.body, `We have received your payment for order ${order.number}. Thank you!`);
  });

  it('sends the receipt when an admin pays through the route', () => {
    const app = createTestApp();
    const { order } = placeOrder(app);
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    const before = app.mailer.sent.length;
    const res = app.call('POST', `/invoices/${order.invoiceId}/pay`, { token: admin.token });
    assert.equal(res.status, 200);
    const subjects = app.mailer.sent.slice(before).map((m) => m.subject);
    assert.deepEqual(subjects, [`Payment received for order ${order.number}`]);
  });

  it('does not send a second receipt when the invoice is already paid', () => {
    const app = createTestApp();
    const { order } = placeOrder(app);
    markPaid(app.ctx, order.invoiceId!);
    const before = app.mailer.sent.length;
    assert.throws(() => markPaid(app.ctx, order.invoiceId!));
    assert.equal(app.mailer.sent.length, before);
  });

  it('only notifies the customer who owns the order', () => {
    const app = createTestApp();
    const a = placeOrder(app, { email: 'a@example.com' });
    const b = placeOrder(app, { email: 'b@example.com' });
    markPaid(app.ctx, a.order.invoiceId!);
    const kinds = (token: string) =>
      (app.call('GET', '/notifications', { token }).body as Notification[]).map((n) => n.kind as string);
    assert.ok(kinds(a.token).includes('payment_received'));
    assert.ok(!kinds(b.token).includes('payment_received'));
  });
});
