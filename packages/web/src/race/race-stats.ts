/** The summary's statistics, computed the way `research/race/harness/summary.py` does. */

/** `round(value, digits)`. */
export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** `summary._pct`: linear interpolation between closest ranks, rounded to 2 decimals. */
export function percentile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const rank = (sorted.length - 1) * q;
  const lo = Math.floor(rank);
  const hi = Math.min(lo + 1, sorted.length - 1);
  const low = sorted[lo] ?? 0;
  const high = sorted[hi] ?? low;
  return roundTo(low + (high - low) * (rank - lo), 2);
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
