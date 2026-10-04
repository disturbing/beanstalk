import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatMoney } from './money.ts';

describe('formatMoney thousands separators', () => {
  it('groups thousands with commas', () => {
    assert.equal(formatMoney(123456789), '$1,234,567.89');
    assert.equal(formatMoney(1200000, 'EUR'), '€12,000.00');
    assert.equal(formatMoney(100000), '$1,000.00');
  });

  it('handles negative amounts', () => {
    assert.equal(formatMoney(-123450), '-$1,234.50');
    assert.equal(formatMoney(-123450, 'CAD'), '-CA$1,234.50');
  });

  it('groups every three digits for very large amounts', () => {
    assert.equal(formatMoney(100000000000, 'GBP'), '£1,000,000,000.00');
    assert.equal(formatMoney(99999999, 'USD'), '$999,999.99');
  });

  it('leaves amounts below 1,000 unchanged', () => {
    assert.equal(formatMoney(99999), '$999.99');
    assert.equal(formatMoney(0), '$0.00');
    assert.equal(formatMoney(5, 'EUR'), '€0.05');
    assert.equal(formatMoney(-25000), '-$250.00');
  });
});
