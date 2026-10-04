import { roundHalfEven } from './numbers';

/**
 * The points a K-ary search probes between `lo` (good) and `hi` (bad): one per CI slot,
 * evenly spaced, as the harness picks them (the queue's prefix bisection and the beanstalk
 * policy's `first_bad` share the formula, Python rounding included).
 */
export function bisectPoints(lo: number, hi: number, ciSlots: number): number[] {
  const count = Math.max(1, Math.min(ciSlots, hi - lo - 1));
  const candidates = Array.from(
    { length: count },
    (_, index) => lo + Math.max(1, roundHalfEven(((hi - lo) * (index + 1)) / (count + 1))),
  );
  const points = [...new Set(candidates)]
    .toSorted((a, b) => a - b)
    .filter((point) => lo < point && point < hi);
  return points.length > 0 ? points : [lo + 1];
}
