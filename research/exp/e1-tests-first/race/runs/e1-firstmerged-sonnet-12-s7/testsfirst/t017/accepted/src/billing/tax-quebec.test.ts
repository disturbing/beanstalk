import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CA_ADDRESS, ON_ADDRESS } from '../lib/testing.ts';
import { taxRateFor } from './tax.ts';

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);

describe('taxRateFor in Quebec', () => {
  it('charges the combined 14.975% on standard goods', () => {
    close(taxRateFor(CA_ADDRESS, 'standard', 0.07), 0.14975);
    close(taxRateFor({ ...CA_ADDRESS, region: 'qc' }, 'standard', 0.07), 0.14975);
  });

  it('charges half the combined rate on reduced goods', () => {
    close(taxRateFor(CA_ADDRESS, 'reduced', 0.07), 0.074875);
  });

  it('still exempts exempt goods', () => {
    assert.equal(taxRateFor(CA_ADDRESS, 'exempt', 0.07), 0);
  });

  it('leaves other provinces unchanged', () => {
    assert.equal(taxRateFor(ON_ADDRESS, 'standard', 0.07), 0.13);
    assert.equal(taxRateFor({ ...ON_ADDRESS, region: 'BC' }, 'standard', 0.07), 0.12);
    assert.equal(taxRateFor({ ...ON_ADDRESS, region: 'NS' }, 'standard', 0.07), 0.15);
    assert.equal(taxRateFor({ ...ON_ADDRESS, region: 'AB' }, 'reduced', 0.07), 0.025);
  });
});
