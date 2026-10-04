import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getCart } from '../cart/service.ts';
import { addCoupon, createTestApp, errorMessage, placeOrder, tryCheckout } from '../lib/testing.ts';

describe('coupon redemption limit', () => {
  it('allows redemptions up to maxRedemptions, then rejects with 409', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'FIRST2', maxRedemptions: 2 });
    placeOrder(app, { email: 'a@example.com', couponCode: 'FIRST2' });
    placeOrder(app, { email: 'b@example.com', couponCode: 'FIRST2' });
    assert.equal(app.ctx.store.coupons.require('FIRST2').redemptions, 2);

    const { res } = tryCheckout(app, { email: 'c@example.com', couponCode: 'FIRST2' });
    assert.equal(res.status, 409);
    assert.equal(errorMessage(res), 'coupon has been fully redeemed');
  });

  it('rejects a coupon that is already at its limit', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'USEDUP', maxRedemptions: 5, redemptions: 5 });
    const { res } = tryCheckout(app, { couponCode: 'USEDUP' });
    assert.equal(res.status, 409);
    assert.equal(errorMessage(res), 'coupon has been fully redeemed');
  });

  it('does not count a redemption or empty the cart when rejected', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'USEDUP', maxRedemptions: 1, redemptions: 1 });
    const { res, user } = tryCheckout(app, { couponCode: 'USEDUP' });
    assert.equal(res.status, 409);
    assert.equal(app.ctx.store.coupons.require('USEDUP').redemptions, 1);
    assert.equal(getCart(app.ctx, user.id).lines.length, 1);
  });

  it('leaves coupons without a limit unaffected', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'FREEFORALL', maxRedemptions: null, redemptions: 1000 });
    const { order } = placeOrder(app, { couponCode: 'FREEFORALL', price: 5000 });
    assert.equal(order.couponCode, 'FREEFORALL');
    assert.equal(order.discount, 500);
  });

  it('still allows checkout without a coupon', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'USEDUP', maxRedemptions: 1, redemptions: 1 });
    const { order } = placeOrder(app, {});
    assert.equal(order.discount, 0);
  });
});
