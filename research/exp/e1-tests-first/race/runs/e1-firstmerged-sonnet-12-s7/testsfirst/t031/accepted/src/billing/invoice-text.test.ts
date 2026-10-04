import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatMoney } from '../lib/money.ts';
import { addCoupon, addProduct, createTestApp, placeOrder, signUp } from '../lib/testing.ts';
import type { Invoice } from '../types.ts';

function setup(options: { couponCode?: string; quantity?: number; price?: number } = {}) {
  const app = createTestApp();
  if (options.couponCode) addCoupon(app.ctx, { id: options.couponCode, kind: 'percent', value: 10 });
  const placed = placeOrder(app, options);
  const invoice = app.call('GET', `/invoices/${placed.order.invoiceId}`, { token: placed.token }).body as Invoice;
  return { app, ...placed, invoice };
}

function textOf(app: ReturnType<typeof createTestApp>, id: string, token: string): string[] {
  const res = app.call('GET', `/invoices/${id}/text`, { token });
  assert.equal(res.status, 200);
  assert.equal(typeof res.body, 'string');
  return (res.body as string).replace(/\n$/, '').split('\n');
}

describe('plain-text invoice', () => {
  it('returns text/plain with a utf-8 charset', () => {
    const { app, invoice, token } = setup();
    const res = app.call('GET', `/invoices/${invoice.id}/text`, { token });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/plain; charset=utf-8');
  });

  it('starts with the invoice number, then item lines, then the totals', () => {
    const { app, invoice, token } = setup({ quantity: 3, price: 1500 });
    const lines = textOf(app, invoice.id, token);
    const cur = invoice.currency;
    const line = invoice.lines[0];
    assert.equal(lines[0], `Invoice ${invoice.number}`);
    assert.equal(lines[1], `3 x ${line.description} - ${formatMoney(line.net, cur)}`);
    assert.equal(lines[2], `Subtotal: ${formatMoney(invoice.subtotal, cur)}`);
    assert.equal(lines[3], `Tax: ${formatMoney(invoice.tax, cur)}`);
    assert.equal(lines[4], `Total: ${formatMoney(invoice.total, cur)}`);
    assert.equal(lines.length, 5);
  });

  it('omits the Discount line when there is no discount', () => {
    const { app, invoice, token } = setup();
    const lines = textOf(app, invoice.id, token);
    assert.ok(!lines.some((l) => l.startsWith('Discount:')));
  });

  it('shows the discount as a negative amount between Subtotal and Tax', () => {
    const { app, invoice, token } = setup({ couponCode: 'SAVE10', price: 5000 });
    assert.ok(invoice.discount > 0);
    const lines = textOf(app, invoice.id, token);
    const cur = invoice.currency;
    assert.deepEqual(lines.slice(-4), [
      `Subtotal: ${formatMoney(invoice.subtotal, cur)}`,
      `Discount: ${formatMoney(-invoice.discount, cur)}`,
      `Tax: ${formatMoney(invoice.tax, cur)}`,
      `Total: ${formatMoney(invoice.total, cur)}`,
    ]);
  });

  it('lists one line per item', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx, 'multi@example.com');
    const a = addProduct(app.ctx, { price: 1000 });
    const b = addProduct(app.ctx, { price: 2500 });
    app.call('POST', '/cart/items', { token, body: { productId: a.id, quantity: 2 } });
    app.call('POST', '/cart/items', { token, body: { productId: b.id, quantity: 1 } });
    const order = app.call('POST', '/checkout', { token, body: { addressIndex: 0 } }).body as { invoiceId: string };
    const invoice = app.call('GET', `/invoices/${order.invoiceId}`, { token }).body as Invoice;
    const lines = textOf(app, invoice.id, token);
    assert.equal(invoice.lines.length, 2);
    assert.equal(lines.length, 1 + invoice.lines.length + 3);
    invoice.lines.forEach((l, i) => {
      assert.equal(lines[1 + i], `${l.quantity} x ${l.description} - ${formatMoney(l.net, invoice.currency)}`);
    });
  });

  it('is visible to the owner and to admins, but not to other customers', () => {
    const { app, invoice, token } = setup();
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    const other = signUp(app.ctx, 'other@example.com');
    assert.equal(app.call('GET', `/invoices/${invoice.id}/text`, { token }).status, 200);
    assert.equal(app.call('GET', `/invoices/${invoice.id}/text`, { token: admin.token }).status, 200);
    assert.equal(app.call('GET', `/invoices/${invoice.id}/text`, { token: other.token }).status, 404);
  });

  it('requires authentication', () => {
    const { app, invoice } = setup();
    assert.equal(app.call('GET', `/invoices/${invoice.id}/text`).status, 401);
  });

  it('returns 404 for an unknown invoice', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx);
    assert.equal(app.call('GET', '/invoices/nope/text', { token }).status, 404);
  });
});
