import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runMigrations } from '../db/migrate.ts';
import { migrations } from '../db/migrations/index.ts';
import { Store } from '../db/store.ts';
import { addProduct, CA_ADDRESS, createTestApp, ON_ADDRESS, signUp, US_ADDRESS } from '../lib/testing.ts';
import type { TestApp } from '../lib/testing.ts';
import type { Address, Invoice, Order, TaxClass, User } from '../types.ts';

const flag = (user: User | undefined) => (user as unknown as { taxExempt?: boolean } | undefined)?.taxExempt;

function checkoutAs(app: TestApp, email: string, taxExempt: boolean, address: Address, taxClass?: TaxClass) {
  const { user, token } = signUp(app.ctx, email, { address });
  if (taxExempt) app.ctx.store.users.update(user.id, { taxExempt: true } as Partial<User>);
  const product = addProduct(app.ctx, { price: 5000, taxClass });
  app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 2 } });
  const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const order = res.body as Order;
  const invoice = app.ctx.store.invoices.require(order.invoiceId as string) as Invoice;
  return { order, invoice };
}

describe('tax-exempt customers', () => {
  it('defaults taxExempt to false for newly registered users', () => {
    const app = createTestApp();
    const { user } = signUp(app.ctx);
    assert.equal(flag(app.ctx.store.users.require(user.id)), false);
  });

  it('migrates existing users to taxExempt false', () => {
    const store = new Store();
    runMigrations(store, migrations.filter((m) => m.version <= 5));
    store.users.insert({
      id: 'usr_0001',
      email: 'old@example.com',
      name: 'Old',
      role: 'customer',
      passwordHash: 'h',
      passwordSalt: 's',
      addresses: [],
      createdAt: new Date(0).toISOString(),
    });
    const ran = runMigrations(store);
    assert.ok(ran.length > 0);
    assert.ok(ran.every((v) => v > 5));
    assert.equal(flag(store.users.require('usr_0001')), false);
  });

  it('charges no tax on any line for an exempt customer', () => {
    const app = createTestApp();
    const { order, invoice } = checkoutAs(app, 'wholesale@example.com', true, ON_ADDRESS);
    assert.ok(invoice.lines.length > 0);
    for (const line of invoice.lines) {
      assert.equal(line.taxRate, 0);
      assert.equal(line.tax, 0);
    }
    assert.equal(invoice.tax, 0);
    assert.equal(invoice.total, 10000);
    assert.equal(order.tax, 0);
    assert.equal(order.subtotal, 10000);
  });

  it('exempts regardless of destination and tax class', () => {
    const app = createTestApp();
    let n = 0;
    for (const address of [CA_ADDRESS, US_ADDRESS, ON_ADDRESS]) {
      for (const taxClass of ['standard', 'reduced', 'exempt'] as TaxClass[]) {
        n += 1;
        const { invoice } = checkoutAs(app, `w${n}@example.com`, true, address, taxClass);
        assert.equal(invoice.tax, 0);
        assert.deepEqual(invoice.lines.map((l) => l.taxRate), [0]);
      }
    }
  });

  it('still taxes customers who are not exempt', () => {
    const app = createTestApp();
    const { invoice } = checkoutAs(app, 'retail@example.com', false, ON_ADDRESS);
    assert.equal(invoice.lines[0].taxRate, 0.13);
    assert.equal(invoice.tax, 1300);
  });

  it('only exempts the flagged customer', () => {
    const app = createTestApp();
    const a = checkoutAs(app, 'a@example.com', true, ON_ADDRESS);
    const b = checkoutAs(app, 'b@example.com', false, ON_ADDRESS);
    assert.equal(a.invoice.tax, 0);
    assert.equal(b.invoice.tax, 1300);
  });
});
