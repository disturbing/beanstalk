import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultConfig, loadConfig } from '../config.ts';
import type { Config } from '../config.ts';
import { createTestApp, ON_ADDRESS } from '../lib/testing.ts';
import { buildInvoice } from './invoice.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

const termsOf = (config: Config): number => (config as Config & { paymentTermsDays: number }).paymentTermsDays;

const items = [{ productId: 'prd_0001', description: 'Thing', quantity: 1, unitPrice: 1000, taxClass: 'standard' as const }];

function invoiceWith(overrides: Record<string, unknown>) {
  const app = createTestApp();
  const ctx = { ...app.ctx, config: { ...app.ctx.config, ...overrides } };
  return buildInvoice(ctx, { orderId: 'ord_0001', userId: 'usr_0001', address: ON_ADDRESS, items });
}

describe('paymentTermsDays config', () => {
  it('defaults to 30', () => {
    assert.equal(termsOf(defaultConfig), 30);
    assert.equal(termsOf(loadConfig({})), 30);
  });

  it('is overridden by PAYMENT_TERMS_DAYS', () => {
    assert.equal(termsOf(loadConfig({ PAYMENT_TERMS_DAYS: '45' })), 45);
  });

  it('rejects a non-numeric PAYMENT_TERMS_DAYS', () => {
    assert.throws(() => loadConfig({ PAYMENT_TERMS_DAYS: 'soon' }));
  });
});

describe('invoice due date', () => {
  it('uses the configured payment terms', () => {
    const invoice = invoiceWith({ paymentTermsDays: 60 });
    assert.equal(new Date(invoice.dueAt).getTime() - new Date(invoice.issuedAt).getTime(), 60 * DAY_MS);
    assert.equal(invoice.dueAt, '2026-11-14T12:00:00.000Z');
  });

  it('supports short terms', () => {
    assert.equal(invoiceWith({ paymentTermsDays: 7 }).dueAt, '2026-09-22T12:00:00.000Z');
  });

  it('is still 30 days with the default configuration', () => {
    assert.equal(invoiceWith({}).dueAt, '2026-10-15T12:00:00.000Z');
  });

  it('follows PAYMENT_TERMS_DAYS loaded through loadConfig', () => {
    const app = createTestApp();
    const config = loadConfig({ PASSWORD_COST: '16', PAYMENT_TERMS_DAYS: '14' });
    const invoice = buildInvoice({ ...app.ctx, config }, { orderId: 'ord_0001', userId: 'usr_0001', address: ON_ADDRESS, items });
    assert.equal(invoice.dueAt, '2026-09-29T12:00:00.000Z');
  });
});
