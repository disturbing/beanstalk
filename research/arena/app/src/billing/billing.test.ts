import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, placeOrder, signUp } from '../lib/testing.ts';
import { findCoupon, getInvoice, markPaid, voidInvoice } from './service.ts';

describe('invoices', () => {
  it('numbers invoices sequentially', () => {
    const app = createTestApp();
    const first = placeOrder(app, { email: 'a@example.com' });
    const second = placeOrder(app, { email: 'b@example.com' });
    const numbers = [first, second].map((p) => getInvoice(app.ctx, p.order.invoiceId!).number);
    assert.ok(numbers.every((n) => n.startsWith('INV-')));
    assert.ok(numbers[1] > numbers[0], 'later invoices sort after earlier ones');
  });

  it('counts coupon redemptions and finds codes in any case', () => {
    const app = createTestApp();
    placeOrder(app, { couponCode: 'welcome10' });
    assert.equal(findCoupon(app.ctx, ' Welcome10 ')?.redemptions, 1);
  });

  it('rejects unknown coupons and ones below their minimum', () => {
    const app = createTestApp();
    assert.throws(() => placeOrder(app, { couponCode: 'NOPE' }), /unknown coupon/);
    assert.throws(() => placeOrder(app, { email: 'b@example.com', couponCode: 'FIVEOFF', price: 1500 }), /at least \$20\.00/);
  });

  it('moves open invoices to paid once, and never voids a paid one', () => {
    const app = createTestApp();
    const { order } = placeOrder(app);
    assert.equal(markPaid(app.ctx, order.invoiceId!).status, 'paid');
    assert.throws(() => markPaid(app.ctx, order.invoiceId!), /is paid/);
    assert.throws(() => voidInvoice(app.ctx, order.invoiceId!), /already paid/);
  });

  it('shows invoices to their owner and to admins only', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app);
    const stranger = signUp(app.ctx, 'stranger@example.com');
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    const path = `/orders/${order.id}/invoice`;
    assert.equal(app.call('GET', path, { token }).status, 200);
    assert.equal(app.call('GET', path, { token: stranger.token }).status, 404);
    assert.equal(app.call('GET', `/invoices/${order.invoiceId}`, { token: admin.token }).status, 200);
  });

});
