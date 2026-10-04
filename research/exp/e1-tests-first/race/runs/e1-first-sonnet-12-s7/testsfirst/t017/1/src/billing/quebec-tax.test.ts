import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CA_ADDRESS, ON_ADDRESS, createTestApp, placeOrder } from '../lib/testing.ts';
import { taxRateFor } from './tax.ts';

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);

describe('Quebec sales tax', () => {
  it('charges the combined 14.975% on standard goods', () => {
    near(taxRateFor(CA_ADDRESS, 'standard', 0.07), 0.14975);
    near(taxRateFor({ ...CA_ADDRESS, region: 'qc' }, 'standard', 0.07), 0.14975);
  });

  it('charges half the combined rate on reduced goods', () => {
    near(taxRateFor(CA_ADDRESS, 'reduced', 0.07), 0.074875);
  });

  it('keeps exempt goods untaxed', () => {
    assert.equal(taxRateFor(CA_ADDRESS, 'exempt', 0.07), 0);
  });

  it('leaves other provinces unchanged', () => {
    assert.equal(taxRateFor(ON_ADDRESS, 'standard', 0.07), 0.13);
    assert.equal(taxRateFor({ ...ON_ADDRESS, region: 'NB' }, 'standard', 0.07), 0.15);
  });

  it('applies the rate to a Quebec order at checkout', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { price: 20000, quantity: 1 });
    assert.equal(order.tax, 2995);
    assert.equal(order.total, 22995);
  });

  it('applies the reduced rate to a Quebec order at checkout', () => {
    const app = createTestApp();
    const { order } = placeOrder(app, { price: 40000, quantity: 1, taxClass: 'reduced' });
    assert.equal(order.tax, 2995);
  });
});
