import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatMoney } from '../lib/money.ts';
import { addCoupon, createTestApp, placeOrder, signUp } from '../lib/testing.ts';
import type { Invoice } from '../types.ts';

function textOf(body: unknown): string {
  assert.equal(typeof body, 'string');
  return body as string;
}

function lines(body: unknown): string[] {
  return textOf(body).split(/\r?\n/).filter((l) => l.length > 0);
}

describe('invoice plain-text rendering', () => {
  it('returns text/plain with the number, item line and totals', () => {
    const app = createTestApp();
    const { order, token, product } = placeOrder(app, { price: 2000, quantity: 3 });
    const invoice = app.call('GET', `/invoices/${order.invoiceId}`, { token }).body as Invoice;
    const res = app.call('GET', `/invoices/${order.invoiceId}/text`, { token });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/plain; charset=utf-8');
    const money = (n: number) => formatMoney(n, invoice.currency);
    assert.ok(invoice.tax > 0);
    assert.ok(textOf(res.body).startsWith(`Invoice ${invoice.number}`));
    assert.deepEqual(lines(res.body), [
      `Invoice ${invoice.number}`,
      `3 x ${product.name} - ${money(6000)}`,
      `Subtotal: ${money(invoice.subtotal)}`,
      `Tax: ${money(invoice.tax)}`,
      `Total: ${money(invoice.total)}`,
    ]);
  });

  it('shows the discount as a negative amount when the invoice has one', () => {
    const app = createTestApp();
    addCoupon(app.ctx, { id: 'TEXT10', kind: 'percent', value: 10 });
    const { order, token } = placeOrder(app, { price: 5000, couponCode: 'TEXT10' });
    const invoice = app.call('GET', `/invoices/${order.invoiceId}`, { token }).body as Invoice;
    assert.equal(invoice.discount, 500);
    const out = lines(app.call('GET', `/invoices/${order.invoiceId}/text`, { token }).body);
    const money = (n: number) => formatMoney(n, invoice.currency);
    assert.deepEqual(out.slice(-4), [
      `Subtotal: ${money(invoice.subtotal)}`,
      `Discount: ${money(-invoice.discount)}`,
      `Tax: ${money(invoice.tax)}`,
      `Total: ${money(invoice.total)}`,
    ]);
  });

  it('renders one line per item in the invoice', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app);
    const invoice = app.call('GET', `/invoices/${order.invoiceId}`, { token }).body as Invoice;
    const out = lines(app.call('GET', `/invoices/${order.invoiceId}/text`, { token }).body);
    const items = out.filter((l) => / x .* - /.test(l));
    assert.equal(items.length, invoice.lines.length);
  });

  it('uses the same visibility rules as the invoice endpoint', () => {
    const app = createTestApp();
    const { order, token } = placeOrder(app);
    const other = signUp(app.ctx, 'other@example.com');
    const admin = signUp(app.ctx, 'admin@example.com', { admin: true });
    const path = `/invoices/${order.invoiceId}/text`;
    assert.equal(app.call('GET', path, { token }).status, 200);
    assert.equal(app.call('GET', path, { token: admin.token }).status, 200);
    assert.equal(
      app.call('GET', path, { token: other.token }).status,
      app.call('GET', `/invoices/${order.invoiceId}`, { token: other.token }).status,
    );
    assert.equal(app.call('GET', path, { token: other.token }).status, 404);
    assert.equal(app.call('GET', path).status, app.call('GET', `/invoices/${order.invoiceId}`).status);
  });

  it('returns 404 for an unknown invoice', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx);
    assert.equal(app.call('GET', '/invoices/nope/text', { token }).status, 404);
  });
});
