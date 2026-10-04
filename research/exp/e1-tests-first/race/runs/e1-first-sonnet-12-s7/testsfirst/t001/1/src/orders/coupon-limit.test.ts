import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addCoupon, createTestApp, errorMessage, placeOrder, tryCheckout } from '../lib/testing.ts';

describe('coupon redemption limit', () => {
  it('rejects checkout with 409 once the coupon is fully redeemed', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'FIRST2', maxRedemptions: 2, redemptions: 2 });
    const { res } = tryCheckout(app, { couponCode: 'FIRST2' });
    assert.equal(res.status, 409);
    assert.equal(errorMessage(res), 'coupon has been fully redeemed');
  });

  it('allows orders up to the limit, then rejects the next one', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'FIRST2', maxRedemptions: 2 });
    placeOrder(app, { couponCode: 'FIRST2', email: 'a@example.com' });
    placeOrder(app, { couponCode: 'FIRST2', email: 'b@example.com' });
    const { res } = tryCheckout(app, { couponCode: 'FIRST2', email: 'c@example.com' });
    assert.equal(res.status, 409);
    assert.equal(errorMessage(res), 'coupon has been fully redeemed');
  });

  it('still allows the last remaining redemption', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'LAST1', maxRedemptions: 5, redemptions: 4 });
    const { order } = placeOrder(app, { couponCode: 'LAST1', price: 5000 });
    assert.equal(order.couponCode, 'LAST1');
    assert.equal(order.discount, 500);
  });

  it('does not create an order when rejected', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'FIRST1', maxRedemptions: 1, redemptions: 1 });
    const { res } = tryCheckout(app, { couponCode: 'FIRST1' });
    assert.equal(res.status, 409);
    assert.equal(app.ctx.store.coupons.get('FIRST1')?.redemptions, 1);
  });

  it('leaves coupons without a limit unaffected', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'FREEFORALL', maxRedemptions: null, redemptions: 1000 });
    const { res } = tryCheckout(app, { couponCode: 'FREEFORALL' });
    assert.equal(res.status, 201);
  });

  it('matches the code case-insensitively', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'FIRST1', maxRedemptions: 1, redemptions: 1 });
    const { res } = tryCheckout(app, { couponCode: 'first1' });
    assert.equal(res.status, 409);
  });
});
