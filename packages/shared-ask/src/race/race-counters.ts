/**
 * The header counters of a race, computed from its state: the numbers `summary.json` and
 * `research/race/kth_green.py` report, so the canvas and the research agree.
 */
import type { RaceEvent } from './race-events';
import type { RaceState } from './race-state';

export type RaceCounters = {
  readonly beans: number;
  readonly landed: number;
  readonly green: number;
  readonly dropped: number;
  /** Started, not landed and not dropped. */
  readonly inFlight: number;
  readonly costUsd: number;
  readonly redValidations: number;
  readonly cards: number;
  readonly openCards: number;
  readonly conflicts: number;
  /** Each bean's first green, ascending (race seconds). */
  readonly greenTimes: readonly number[];
  /** `race.end` minus `race.start`, once the race ended (`wall_seconds`). */
  readonly wallSeconds: number | null;
};

export function raceCounters(state: RaceState): RaceCounters {
  const beans = Object.values(state.beans);
  const started = state.meta?.startedAt ?? null;
  return {
    beans: state.order.length,
    landed: beans.filter((bean) => bean.landedSha !== null).length,
    green: beans.filter((bean) => bean.phase === 'green').length,
    dropped: beans.filter((bean) => bean.phase === 'dropped').length,
    inFlight: beans.filter((bean) => isInFlight(bean.phase)).length,
    costUsd: state.totals.costUsd,
    redValidations: state.totals.redValidations,
    cards: state.cards.length,
    openCards: state.cards.filter((card) => card.status === 'open').length,
    conflicts: state.totals.conflicts,
    greenTimes: beans
      .flatMap((bean) => (bean.greenAt === null ? [] : [bean.greenAt]))
      .toSorted((a, b) => a - b),
    wallSeconds: state.endedAt === null || started === null ? null : state.endedAt - started,
  };
}

/** A bean an agent is still carrying: started, not on a line, not dropped. */
export function isInFlight(phase: RaceState['beans'][string]['phase']): boolean {
  return phase !== 'pending' && phase !== 'landed' && phase !== 'green' && phase !== 'dropped';
}

/** When the k-th bean reached the stalk, or null before it did (`kth_green.py`). */
export function kthGreenAt(counters: RaceCounters, k: number): number | null {
  return counters.greenTimes[k - 1] ?? null;
}

/** Agent spend up to and including race second `t` (`kth_green.py` `cost_at`). */
export function costAt(events: readonly RaceEvent[], t: number): number {
  let total = 0;
  for (const event of events) {
    if (event.t > t) break;
    if (event.type === 'invocation.end') total += event.cost_usd;
  }
  return total;
}
