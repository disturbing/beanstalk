import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateDelivery } from '../src/shipping.mjs';

test('one business day from Friday preserves three elapsed calendar days', () => {
  assert.deepEqual(estimateDelivery({ shippedOn: '2026-10-09', businessDays: 1 }),
    { days: 3, businessDays: 1, deliveryDate: '2026-10-12' });
});

test('an explicit Monday holiday adds a calendar day but not a business day', () => {
  assert.deepEqual(estimateDelivery({ shippedOn: '2026-10-09', businessDays: 1, holidays: ['2026-10-12'] }),
    { days: 4, businessDays: 1, deliveryDate: '2026-10-13' });
});

test('two business days cross a year boundary using UTC calendar dates', () => {
  assert.deepEqual(estimateDelivery({ shippedOn: '2026-12-31', businessDays: 2, holidays: ['2027-01-01'] }),
    { days: 5, businessDays: 2, deliveryDate: '2027-01-05' });
});

test('zero business days deliver on the starting date even on a weekend', () => {
  assert.deepEqual(estimateDelivery({ shippedOn: '2026-10-10', businessDays: 0 }),
    { days: 0, businessDays: 0, deliveryDate: '2026-10-10' });
});

test('invalid dates and negative or fractional business-day counts fail explicitly', () => {
  assert.throws(() => estimateDelivery({ shippedOn: '2026-02-30', businessDays: 1 }));
  assert.throws(() => estimateDelivery({ shippedOn: '2026-10-09', businessDays: -1 }));
  assert.throws(() => estimateDelivery({ shippedOn: '2026-10-09', businessDays: 0.5 }));
});
