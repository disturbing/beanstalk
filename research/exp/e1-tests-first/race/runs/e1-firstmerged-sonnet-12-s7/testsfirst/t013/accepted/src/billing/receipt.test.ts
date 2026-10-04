import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, placeOrder, signUp } from '../lib/testing.ts';
import type { Notification } from '../types.ts';
import { markPaid } from './service.ts';

describe('payment receipts', () => {
  it('emails the customer a receipt when the invoice is marked paid', () => {
    const app = createTestApp();
    const { order, user } = placeOrder(app);
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
  });

  it('sends the receipt when an admin pays through the API, once only', () => {
    const app = createTestApp();
    const { order } = placeOrder(app);
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    const before = app.mailer.sent.length;
    assert.equal(app.call('POST', `/invoices/${order.invoiceId}/pay`, { token: admin.token }).status, 200);
    assert.ok(app.call('POST', `/invoices/${order.invoiceId}/pay`, { token: admin.token }).status >= 400);
    const receipts = app.mailer.sent.slice(before).filter((m) => m.subject.startsWith('Payment received'));
    assert.equal(receipts.length, 1);
  });

  it('sends no receipt before payment', () => {
    const app = createTestApp();
    placeOrder(app);
    assert.equal(app.mailer.sent.filter((m) => m.subject.startsWith('Payment received')).length, 0);
  });
});
