import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addCoupon, createTestApp, errorMessage, placeOrder, tryCheckout } from '../lib/testing.ts';

describe('coupon expiry', () => {
  it('rejects a coupon that expired in the past with 400', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'OLD', expiresAt: '2026-08-01T00:00:00.000Z' });
    const { res } = tryCheckout(app, { couponCode: 'OLD' });
    assert.equal(res.status, 400);
    assert.equal(errorMessage(res), 'coupon has expired');
  });

  it('rejects a coupon at exactly its expiry time', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'EDGE', expiresAt: app.clock.now().toISOString() });
    const { res } = tryCheckout(app, { couponCode: 'EDGE' });
    assert.equal(res.status, 400);
    assert.equal(errorMessage(res), 'coupon has expired');
  });

  it('accepts a coupon one millisecond before its expiry', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'SOON', expiresAt: new Date(app.clock.now().getTime() + 1).toISOString() });
    const { order } = placeOrder(app, { couponCode: 'SOON', price: 5000 });
    assert.equal(order.discount, 500);
  });

  it('accepts a coupon that expires in the future', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'LATER', expiresAt: '2027-01-01T00:00:00.000Z' });
    const { order } = placeOrder(app, { couponCode: 'LATER', price: 5000 });
    assert.equal(order.couponCode, 'LATER');
    assert.equal(order.discount, 500);
  });

  it('accepts a coupon without an expiry', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'FOREVER', expiresAt: null });
    const { res } = tryCheckout(app, { couponCode: 'FOREVER' });
    assert.equal(res.status, 201);
  });

  it('rejects a coupon once the clock advances past its expiry', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'TICK', expiresAt: new Date(app.clock.now().getTime() + 60_000).toISOString() });
    placeOrder(app, { couponCode: 'TICK', email: 'a@example.com' });
    app.clock.advance(60_000);
    const { res } = tryCheckout(app, { couponCode: 'TICK', email: 'b@example.com' });
    assert.equal(res.status, 400);
    assert.equal(errorMessage(res), 'coupon has expired');
  });

  it('does not count a redemption when rejected', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'OLD', expiresAt: '2026-08-01T00:00:00.000Z' });
    tryCheckout(app, { couponCode: 'OLD' });
    assert.equal(app.ctx.store.coupons.get('OLD')?.redemptions, 0);
  });
});
