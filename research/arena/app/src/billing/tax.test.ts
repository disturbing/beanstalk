import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CA_ADDRESS, ON_ADDRESS, US_ADDRESS } from '../lib/testing.ts';
import { taxRateFor } from './tax.ts';

describe('taxRateFor', () => {
  it('looks up provincial and state rates', () => {
    assert.equal(taxRateFor(ON_ADDRESS, 'standard', 0.07), 0.13);
    assert.equal(taxRateFor(US_ADDRESS, 'standard', 0.07), 0.065);
    assert.equal(taxRateFor({ ...ON_ADDRESS, region: 'ab' }, 'standard', 0.07), 0.05);
  });

  it('halves the rate for reduced goods and zeroes exempt ones', () => {
    assert.equal(taxRateFor(ON_ADDRESS, 'reduced', 0.07), 0.065);
    assert.equal(taxRateFor(ON_ADDRESS, 'exempt', 0.07), 0);
  });

  it('falls back for regions it does not know', () => {
    assert.equal(taxRateFor({ ...CA_ADDRESS, country: 'JP', region: 'Tokyo' }, 'standard', 0.1), 0.1);
  });
});
