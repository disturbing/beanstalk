/** `round(value, digits)` for reported numbers (seconds, dollars). */
export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Python's `round(value)` to an integer: halves go to the even neighbour. The queue's
 * bisection points use it, so the probes match the harness exactly.
 */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction > 0.5) return floor + 1;
  if (fraction < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** `str(float)` in Python: integral values keep one decimal (`60.0`), others print as in JS. */
export function pythonFloat(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

/** `str(dict)` of a string-keyed count dict, as summary rows embed it: `{'read-set': 1}`. */
export function pythonCounts(counts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(counts).map(([key, count]) => `'${key}': ${count}`);
  return `{${entries.join(', ')}}`;
}

/** The harness's `ts` format: ISO 8601 with milliseconds and an explicit UTC offset. */
export function isoTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/Z$/, '+00:00');
}

/** Python's `statistics.fmean`, for non-empty lists. */
export function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** `summary._pct`: linear interpolation between closest ranks, rounded to 2 decimals. */
export function percentile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const k = (sorted.length - 1) * q;
  const lo = Math.floor(k);
  const hi = Math.min(lo + 1, sorted.length - 1);
  const low = sorted[lo] ?? 0;
  const high = sorted[hi] ?? low;
  return roundTo(low + (high - low) * (k - lo), 2);
}

/**
 * A small seeded generator (mulberry32) for the optional task shuffle. Python's
 * `random.Random(f"{seed}:order")` cannot be reproduced exactly, so a shuffled cloud run
 * orders tasks differently from a shuffled local run with the same seed.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
