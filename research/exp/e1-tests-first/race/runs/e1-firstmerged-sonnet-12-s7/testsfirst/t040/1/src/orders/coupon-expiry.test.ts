import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getCart } from '../cart/service.ts';
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
    addCoupon(app.ctx, { id: 'NOW', expiresAt: app.clock.now().toISOString() });
    const { res } = tryCheckout(app, { couponCode: 'NOW' });
    assert.equal(res.status, 400);
    assert.equal(errorMessage(res), 'coupon has expired');
  });

  it('accepts a coupon until its expiry, then rejects it once the clock reaches it', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'SOON', expiresAt: new Date(app.clock.now().getTime() + 60_000).toISOString() });
    const { order } = placeOrder(app, { email: 'a@example.com', couponCode: 'SOON', price: 5000 });
    assert.equal(order.discount, 500);

    app.clock.advance(60_000);
    const { res } = tryCheckout(app, { email: 'b@example.com', couponCode: 'SOON' });
    assert.equal(res.status, 400);
    assert.equal(errorMessage(res), 'coupon has expired');
  });

  it('does not count a redemption or empty the cart when rejected', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'OLD', expiresAt: '2026-08-01T00:00:00.000Z' });
    const { res, user } = tryCheckout(app, { couponCode: 'OLD' });
    assert.equal(res.status, 400);
    assert.equal(app.ctx.store.coupons.require('OLD').redemptions, 0);
    assert.equal(getCart(app.ctx, user.id).lines.length, 1);
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
    const { order } = placeOrder(app, { couponCode: 'FOREVER', price: 5000 });
    assert.equal(order.discount, 500);
  });
});
