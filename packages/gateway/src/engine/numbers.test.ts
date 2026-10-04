import { describe, expect, it } from 'vitest';

import { isoTimestamp, percentile, roundHalfEven } from './numbers';
import { bisectPoints } from './bisect';

describe('roundHalfEven', () => {
  it('rounds halves to the even neighbour like Python round()', () => {
    expect([0.5, 1.5, 2.5, 3.5, 2.4, 2.6].map(roundHalfEven)).toEqual([0, 2, 2, 4, 2, 3]);
  });
});

describe('bisectPoints', () => {
  // [lo, hi, K, points] computed with policy_queue.py's formula.
  const cases: readonly [number, number, number, number[]][] = [
    [0, 2, 1, [1]],
    [0, 3, 1, [2]],
    [0, 3, 2, [1, 2]],
    [0, 4, 2, [1, 3]],
    [0, 5, 2, [2, 3]],
    [0, 5, 3, [1, 2, 4]],
    [0, 7, 1, [4]],
    [0, 7, 3, [2, 4, 5]],
    [0, 7, 4, [1, 3, 4, 6]],
    [1, 6, 1, [3]],
    [1, 6, 3, [2, 3, 5]],
    [2, 9, 4, [3, 5, 6, 8]],
    [0, 16, 4, [3, 6, 10, 13]],
    [3, 4, 2, [4]],
  ];

  it.each(cases)(
    'probes prefixes between %i and %i with %i slots as the harness does',
    (lo, hi, slots, points) => {
      expect(bisectPoints(lo, hi, slots)).toEqual(points);
    },
  );
});

describe('formatting', () => {
  it('writes timestamps with an explicit UTC offset, as Python isoformat does', () => {
    expect(isoTimestamp(Date.UTC(2026, 9, 3, 0, 17, 49, 13))).toBe('2026-10-03T00:17:49.013+00:00');
  });

  it('interpolates percentiles between closest ranks', () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentile([10, 20, 30, 40], 0.9)).toBe(37);
    expect(percentile([], 0.5)).toBeNull();
  });
});
