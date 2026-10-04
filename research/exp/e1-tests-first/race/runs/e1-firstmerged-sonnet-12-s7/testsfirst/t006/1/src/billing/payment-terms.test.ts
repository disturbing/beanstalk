import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultConfig, loadConfig } from '../config.ts';
import type { Config } from '../config.ts';
import { createTestApp, ON_ADDRESS } from '../lib/testing.ts';
import { buildInvoice } from './invoice.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

const termsOf = (config: Config): unknown => (config as unknown as Record<string, unknown>).paymentTermsDays;

function invoiceWith(overrides: Record<string, unknown> | Config = {}) {
  const app = createTestApp();
  return buildInvoice(
    { ...app.ctx, config: { ...app.ctx.config, ...overrides } },
    {
      orderId: 'ord_0001',
      userId: 'usr_0001',
      address: ON_ADDRESS,
      items: [{ productId: 'prd_0001', description: 'Thing', quantity: 1, unitPrice: 1000, taxClass: 'standard' }],
    },
  );
}

const daysUntilDue = (inv: { issuedAt: string; dueAt: string }) =>
  (new Date(inv.dueAt).getTime() - new Date(inv.issuedAt).getTime()) / DAY_MS;

describe('paymentTermsDays config', () => {
  it('defaults to 30', () => {
    assert.equal(termsOf(defaultConfig), 30);
    assert.equal(termsOf(loadConfig({})), 30);
  });

  it('is overridden by PAYMENT_TERMS_DAYS', () => {
    assert.equal(termsOf(loadConfig({ PAYMENT_TERMS_DAYS: '60' })), 60);
  });

  it('keeps the default when PAYMENT_TERMS_DAYS is empty', () => {
    assert.equal(termsOf(loadConfig({ PAYMENT_TERMS_DAYS: '' })), 30);
  });

  it('rejects a non-numeric PAYMENT_TERMS_DAYS', () => {
    assert.throws(() => loadConfig({ PAYMENT_TERMS_DAYS: 'soon' }), /invalid integer/);
  });
});

describe('invoice due date', () => {
  it('is 30 days after issue by default', () => {
    assert.equal(daysUntilDue(invoiceWith()), 30);
  });

  it('uses the configured paymentTermsDays', () => {
    assert.equal(daysUntilDue(invoiceWith({ paymentTermsDays: 45 })), 45);
    assert.equal(daysUntilDue(invoiceWith({ paymentTermsDays: 7 })), 7);
  });

  it('is due on the issue date when terms are 0', () => {
    const inv = invoiceWith({ paymentTermsDays: 0 });
    assert.equal(inv.dueAt, inv.issuedAt);
  });

  it('uses the terms from a config loaded with PAYMENT_TERMS_DAYS', () => {
    const config = loadConfig({ PASSWORD_COST: '16', PAYMENT_TERMS_DAYS: '14' });
    assert.equal(daysUntilDue(invoiceWith(config)), 14);
  });
});
