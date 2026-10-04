import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allocate, applyRate, formatMoney, parseMoney, percentOf, roundCents, sumCents } from './money.ts';

describe('money', () => {
  it('rounds half away from zero and never returns -0', () => {
    assert.equal(roundCents(2.5), 3);
    assert.equal(roundCents(-2.5), -3);
    assert.equal(roundCents(0.4), 0);
    assert.ok(Object.is(roundCents(-0.2), 0));
  });

  it('applies a rate and rounds once', () => {
    assert.equal(applyRate(10, 0.25), 3);
    assert.equal(applyRate(1999, 0.05), 100);
    assert.equal(percentOf(2500, 10), 250);
  });

  it('allocates with the largest-remainder method so parts add up', () => {
    assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
    assert.equal(sumCents(allocate(999, [3, 5, 7])), 999);
    assert.deepEqual(allocate(10, [0, 0]), [0, 0]);
    assert.deepEqual(allocate(10, []), []);
  });

  it('formats amounts with the currency symbol', () => {
    assert.equal(formatMoney(1234), '$12.34');
    assert.equal(formatMoney(5, 'EUR'), '€0.05');
    assert.equal(formatMoney(-250, 'CAD'), '-CA$2.50');
  });

  it('parses decimal strings into cents', () => {
    assert.equal(parseMoney('12.5'), 1250);
    assert.equal(parseMoney(' 12 '), 1200);
    assert.equal(parseMoney('12.345'), null);
    assert.equal(parseMoney('abc'), null);
  });
});
