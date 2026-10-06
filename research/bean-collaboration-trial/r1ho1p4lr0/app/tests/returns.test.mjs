import test from 'node:test';
import assert from 'node:assert/strict';
import { returnPolicy } from '../src/returns.mjs';

test('returns calculate thirty calendar days from delivery rather than shipment', () => {
  assert.deepEqual(returnPolicy({ shippedOn: '2026-10-09', businessDays: 1 }),
    { deliveryDate: '2026-10-12', returnBy: '2026-11-11', windowDays: 30 });
});

test('a holiday shifts delivery and return deadline consistently', () => {
  assert.deepEqual(returnPolicy({ shippedOn: '2026-10-09', businessDays: 1, holidays: ['2026-10-12'] }),
    { deliveryDate: '2026-10-13', returnBy: '2026-11-12', windowDays: 30 });
});

test('return deadlines can land on weekends', () => {
  assert.deepEqual(returnPolicy({ shippedOn: '2026-10-09', businessDays: 0 }),
    { deliveryDate: '2026-10-09', returnBy: '2026-11-08', windowDays: 30 });
});
