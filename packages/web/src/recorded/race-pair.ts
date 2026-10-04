/** The recorded race of the demo: the merge queue against beanstalk v2, same tasks and seed. */
import type { RunId } from '@beanstalk/shared-race/ids';

import type { RaceEvent } from '../race/race-events';
import { raceCounters } from '../race/race-counters';
import { reduceRace } from '../race/reduce-race';
import type { RecordedRun } from './recorded-runs';
import { RACE_PAIR, recordedRun } from './recorded-runs';

export type RaceSide = {
  readonly run: RunId;
  readonly label: string;
  readonly summary: string;
  readonly policy: 'queue' | 'beanstalk';
  readonly events: readonly RaceEvent[];
  readonly titles: Readonly<Record<string, string>>;
  readonly greens: readonly number[];
  readonly endedAt: number | null;
  readonly wallSeconds: number | null;
  readonly beans: number;
  readonly costUsd: number;
  readonly redValidations: number;
};

export function racePair(): { readonly left: RaceSide; readonly right: RaceSide } {
  return { left: side(RACE_PAIR.left), right: side(RACE_PAIR.right) };
}

function side(run: string): RaceSide {
  const recorded = required(run);
  const state = reduceRace(recorded.events);
  const counters = raceCounters(state);
  return {
    run: recorded.run,
    label: recorded.label,
    summary: recorded.summary,
    policy: state.meta?.policy ?? 'beanstalk',
    events: recorded.events,
    titles: titlesOf(recorded),
    greens: counters.greenTimes,
    endedAt: state.endedAt,
    wallSeconds: counters.wallSeconds,
    beans: counters.beans,
    costUsd: counters.costUsd,
    redValidations: counters.redValidations,
  };
}

export function titlesOf(recorded: RecordedRun): Readonly<Record<string, string>> {
  return Object.fromEntries(recorded.tasks.map((task) => [task.id, task.title]));
}

function required(run: string): RecordedRun {
  const recorded = recordedRun(run);
  if (recorded === undefined) throw new Error(`the recorded run ${run} is not bundled`);
  return recorded;
}
