import type { Cents, Currency } from '../types.ts';

const SYMBOLS: Record<Currency, string> = { USD: '$', CAD: 'CA$', EUR: '€', GBP: '£' };

/** Round half away from zero. Every rounding decision in the shop goes through here. */
export function roundCents(value: number): Cents {
  const rounded = Math.sign(value) * Math.round(Math.abs(value));
  return rounded === 0 ? 0 : rounded;
}

/** Apply a fractional rate (0.05 = 5%) to an amount, rounding to whole cents. */
export function applyRate(amount: Cents, rate: number): Cents {
  return roundCents(amount * rate);
}

/** `percent` is a plain percentage: 10 means 10%. */
export function percentOf(amount: Cents, percent: number): Cents {
  return applyRate(amount, percent / 100);
}

export function sumCents(values: Cents[]): Cents {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Split `total` proportionally to `weights` using the largest-remainder method,
 * so the parts always add up to `total` exactly.
 */
export function allocate(total: Cents, weights: number[]): Cents[] {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (weightSum === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / weightSum);
  const parts = exact.map((x) => Math.floor(x));
  let leftover = total - sumCents(parts);
  const byRemainder = exact
    .map((x, index) => ({ index, remainder: x - Math.floor(x) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of byRemainder) {
    if (leftover <= 0) break;
    parts[index] += 1;
    leftover -= 1;
  }
  return parts;
}

export function formatMoney(amount: Cents, currency: Currency = 'USD'): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  return `${sign}${SYMBOLS[currency]}${whole}.${fraction}`;
}

/** Parse "12.34" (or "12") into cents. Returns null for anything else. */
export function parseMoney(text: string): Cents | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const cents = (match[2] ?? '').padEnd(2, '0');
  return Number.parseInt(match[1], 10) * 100 + Number.parseInt(cents || '0', 10);
}
