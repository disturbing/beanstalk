import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteCheckout } from '../src/checkout.mjs';

test('checkout displays calendar days separately from business days', () => {
  assert.deepEqual(quoteCheckout({ shippedOn: '2026-10-09', businessDays: 1 }),
    { estimatedDeliveryDays: 3, estimatedBusinessDays: 1, estimatedDeliveryDate: '2026-10-12' });
});

test('checkout forwards holiday semantics from the shipping provider', () => {
  assert.deepEqual(quoteCheckout({ shippedOn: '2026-10-09', businessDays: 1, holidays: ['2026-10-12'] }),
    { estimatedDeliveryDays: 4, estimatedBusinessDays: 1, estimatedDeliveryDate: '2026-10-13' });
});
