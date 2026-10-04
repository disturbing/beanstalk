import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { addProduct, createTestApp, CA_ADDRESS, signUp } from './lib/testing.ts';
import type { Order } from './types.ts';

describe('app', () => {
  it('wires a migrated database and the configured currency', () => {
    const app = createApp({ config: loadConfig({ SHOP_CURRENCY: 'CAD', PASSWORD_COST: '16' }) });
    assert.equal(app.ctx.config.currency, 'CAD');
    assert.ok(app.ctx.store.coupons.get('FIVEOFF'));
    assert.equal(app.handle({ method: 'GET', path: '/products' }).status, 200);
  });

  it('runs a customer from sign-up to a shipped parcel', () => {
    const app = createTestApp();
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    const product = addProduct(app.ctx, { price: 4200, stock: 3 });
    app.call('POST', '/users', { body: { email: 'new@example.com', name: 'New', password: 'hunter2hunter2' } });
    const login = app.call('POST', '/auth/login', { body: { email: 'new@example.com', password: 'hunter2hunter2' } });
    const token = (login.body as { token: string }).token;
    app.call('POST', '/users/me/addresses', { token, body: { ...CA_ADDRESS, region: 'ON' } });
    app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 2 } });
    const order = app.call('POST', '/checkout', { token, body: { addressIndex: 0, couponCode: 'WELCOME10' } }).body as Order;
    app.call('POST', `/invoices/${order.invoiceId}/pay`, { token: admin.token });
    app.call('POST', `/orders/${order.id}/ship`, { token: admin.token, body: { trackingNumber: 'ZX-1' } });
    const mine = app.call('GET', `/orders/${order.id}`, { token }).body as Order;
    assert.equal(mine.status, 'shipped');
    assert.ok(app.mailer.sent.every((m) => m.to === 'new@example.com'));
    assert.ok(app.mailer.sent.some((m) => /confirmed/.test(m.subject)));
    assert.ok(app.mailer.sent.some((m) => /has shipped/.test(m.subject)));
  });
});
