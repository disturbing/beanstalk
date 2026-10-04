import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase, runMigrations } from '../db/migrate.ts';
import { migrations } from '../db/migrations/index.ts';
import { Store } from '../db/store.ts';
import { addProduct, createTestApp, ON_ADDRESS, signUp, US_ADDRESS } from '../lib/testing.ts';
import type { TestApp } from '../lib/testing.ts';
import type { Address, Invoice, Order, TaxClass, User } from '../types.ts';
import { buildInvoice } from './invoice.ts';

const flagOf = (user: User) => (user as unknown as { taxExempt?: boolean }).taxExempt;

function setExempt(app: TestApp, userId: string, value: boolean) {
  app.ctx.store.users.update(userId, { taxExempt: value } as Partial<User>);
}

function order(app: TestApp, opts: { exempt: boolean; address: Address; taxClasses: TaxClass[] }) {
  const { user, token } = signUp(app.ctx, 'wholesale@example.com', { address: opts.address });
  if (opts.exempt) setExempt(app, user.id, true);
  for (const taxClass of opts.taxClasses) {
    const product = addProduct(app.ctx, { price: 5000, taxClass });
    app.call('POST', '/cart/items', { token, body: { productId: product.id, quantity: 2 } });
  }
  const res = app.call('POST', '/checkout', { token, body: { addressIndex: 0 } });
  assert.equal(res.status, 201);
  const placed = res.body as Order;
  const invoice = app.ctx.store.invoices.findOne((i) => i.orderId === placed.id) as Invoice;
  return { placed, invoice };
}

const oldUser = (id: string) => ({
  id,
  email: `${id}@example.com`,
  name: 'Old',
  role: 'customer' as const,
  passwordHash: 'h',
  passwordSalt: 's',
  addresses: [],
  createdAt: '2026-01-01T00:00:00.000Z',
});

describe('tax-exempt customers', () => {
  it('defaults taxExempt to false for new users', () => {
    const app = createTestApp();
    const { user } = signUp(app.ctx);
    assert.equal(flagOf(app.ctx.store.users.require(user.id)), false);
  });

  it('charges no tax on any line, whatever the class or destination', () => {
    for (const address of [ON_ADDRESS, US_ADDRESS]) {
      const app = createTestApp();
      const { placed, invoice } = order(app, {
        exempt: true,
        address,
        taxClasses: ['standard', 'reduced', 'exempt'],
      });
      assert.equal(invoice.lines.length, 3);
      assert.ok(invoice.lines.every((l) => l.taxRate === 0 && l.tax === 0));
      assert.equal(invoice.tax, 0);
      assert.equal(invoice.total, invoice.subtotal - invoice.discount);
      assert.equal(placed.tax, 0);
      assert.equal(placed.total, invoice.total);
    }
  });

  it('charges no tax on an unknown region either', () => {
    const app = createTestApp();
    const { invoice } = order(app, {
      exempt: true,
      address: { ...US_ADDRESS, region: 'ZZ', country: 'XX' },
      taxClasses: ['standard'],
    });
    assert.equal(invoice.tax, 0);
  });

  it('still taxes non-exempt customers', () => {
    const app = createTestApp();
    const { invoice } = order(app, { exempt: false, address: ON_ADDRESS, taxClasses: ['standard'] });
    assert.equal(invoice.lines[0].taxRate, 0.13);
    assert.equal(invoice.tax, 1300);
  });

  it('keeps tax at zero when a coupon applies', () => {
    const app = createTestApp();
    const { user } = signUp(app.ctx, 'w2@example.com', { address: ON_ADDRESS });
    setExempt(app, user.id, true);
    const invoice = buildInvoice(app.ctx, {
      orderId: 'ord_0001',
      userId: user.id,
      address: ON_ADDRESS,
      items: [{ productId: 'prd_0001', description: 'Thing', quantity: 1, unitPrice: 5000, taxClass: 'standard' }],
      coupon: { id: 'TAKE20', kind: 'percent', value: 20, minSubtotal: 0, expiresAt: null, maxRedemptions: null, redemptions: 0 },
    });
    assert.equal(invoice.lines[0].taxRate, 0);
    assert.equal(invoice.tax, 0);
    assert.equal(invoice.total, 4000);
  });

  it('buildInvoice taxes a non-exempt user normally', () => {
    const app = createTestApp();
    const { user } = signUp(app.ctx, 'w3@example.com', { address: ON_ADDRESS });
    const invoice = buildInvoice(app.ctx, {
      orderId: 'ord_0001',
      userId: user.id,
      address: ON_ADDRESS,
      items: [{ productId: 'prd_0001', description: 'Thing', quantity: 1, unitPrice: 5000, taxClass: 'standard' }],
    });
    assert.equal(invoice.tax, 650);
  });
});

describe('taxExempt migration', () => {
  it('is registered after the existing migrations and backfills false', () => {
    const last = migrations.at(-1)!;
    assert.ok(last.version > 5);
    const store = new Store();
    runMigrations(store, migrations.filter((m) => m.version <= 5));
    store.users.insert(oldUser('usr_0001'));
    assert.deepEqual(runMigrations(store), [last.version]);
    assert.equal(flagOf(store.users.require('usr_0001')), false);
  });

  it('gives users inserted after migration a false flag', () => {
    const store = openDatabase();
    const user = store.users.insert(oldUser('usr_0002') as User);
    assert.equal(flagOf(user), false);
  });
});
