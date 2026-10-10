'use client';

import { useMemo } from 'react';

import { raceCounters } from '@gitstalk/shared-ask/race/race-counters';
import { kthGreenAt } from '@gitstalk/shared-ask/race/race-counters';
import type { RaceEvent } from '@gitstalk/shared-ask/race/race-events';
import { formatClock, formatMinutes, formatUsd } from '../../src/race/race-format';
import type { RaceMoment } from '../../src/race/race-moments';
import { raceMoments } from '../../src/race/race-moments';
import type { RaceOptions, RaceState } from '@gitstalk/shared-ask/race/race-state';
import { reduceRace } from '@gitstalk/shared-ask/race/reduce-race';
import { ReplayBar } from '../canvas/replay-bar';
import type { Speed } from '../canvas/use-replay-clock';
import { useReplayClock } from '../canvas/use-replay-clock';
import { Vine } from '../canvas/vine';
import { GreensChart } from './greens-chart';
import styles from './race-duel.module.css';

export type DuelSide = {
  readonly run: string;
  readonly label: string;
  readonly summary: string;
  readonly color: string;
  readonly events: readonly RaceEvent[];
  readonly options: RaceOptions;
  readonly titles: Readonly<Record<string, string>>;
};

/** The k-th green the demo measures "most of the work" by (`research/race/kth_green.py`). */
const MOST_GREENS = 35;

/**
 * Two recorded runs replayed on one clock: the merge queue and Beanstalk v2.5, same tasks,
 * same seed, same agents. Counters, both vines and the greens-over-time chart move together.
 */
export function RaceDuel(props: {
  readonly left: DuelSide;
  readonly right: DuelSide;
  readonly initialT: number;
  readonly initialSpeed: Speed;
}) {
  const end = Math.max(raceEnd(props.left.events), raceEnd(props.right.events));
  const clock = useReplayClock({ end, initial: props.initialT, speed: props.initialSpeed });
  const left = useSideState(props.left, clock.now);
  const right = useSideState(props.right, clock.now);
  const leftFull = useMemo(
    () => reduceRace(props.left.events, props.left.options),
    [props.left.events, props.left.options],
  );
  const rightFull = useMemo(
    () => reduceRace(props.right.events, props.right.options),
    [props.right.events, props.right.options],
  );
  const moments = useMemo(
    () =>
      [
        ...raceMoments(props.right.events).filter((moment) => moment.label.includes('Decision')),
        ...mostGreensMoment(props.left.label, leftFull),
        ...mostGreensMoment(props.right.label, rightFull),
      ].toSorted((a, b) => a.t - b.t),
    [props.left.label, props.right.label, props.right.events, leftFull, rightFull],
  );
  return (
    <div className={styles.duel}>
      <ReplayBar clock={clock} moments={moments} label="both runs" placement="inline" />
      <div className={styles.sides}>
        <SideView side={props.left} state={left} now={clock.now} />
        <SideView side={props.right} state={right} now={clock.now} />
      </div>
      <Verdict
        left={{ side: props.left, state: left }}
        right={{ side: props.right, state: right }}
      />
      <section className={styles.chart} aria-label="Beans on the stalk over time">
        <GreensChart
          title="Beans on the stalk, run clock"
          series={[
            {
              id: 'left',
              label: props.left.label,
              color: props.left.color,
              greens: raceCounters(leftFull).greenTimes,
              endedAt: leftFull.endedAt,
            },
            {
              id: 'right',
              label: props.right.label,
              color: props.right.color,
              greens: raceCounters(rightFull).greenTimes,
              endedAt: rightFull.endedAt,
            },
          ]}
          now={clock.now}
          until={end}
          beans={leftFull.order.length}
          marks={[20, 30, 35]}
        />
      </section>
    </div>
  );
}

/** Where to pause for the demo's contrast: each side's 35th bean on the stalk. */
function mostGreensMoment(label: string, state: RaceState): readonly RaceMoment[] {
  const at = kthGreenAt(raceCounters(state), MOST_GREENS);
  return at === null
    ? []
    : [{ t: at, label: `${formatClock(at)}  ${label}: ${MOST_GREENS}th bean on the stalk` }];
}

function raceEnd(events: readonly RaceEvent[]): number {
  return events.findLast((event) => event.type === 'race.end')?.t ?? events.at(-1)?.t ?? 0;
}

function useSideState(side: DuelSide, now: number): RaceState {
  const count = useMemo(() => countUpTo(side.events, now), [side.events, now]);
  return useMemo(
    () => reduceRace(side.events.slice(0, count), side.options),
    [side.events, side.options, count],
  );
}

function countUpTo(events: readonly RaceEvent[], t: number): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((events[middle]?.t ?? Number.POSITIVE_INFINITY) <= t) low = middle + 1;
    else high = middle;
  }
  return low;
}

function SideView({
  side,
  state,
  now,
}: {
  readonly side: DuelSide;
  readonly state: RaceState;
  readonly now: number;
}) {
  const counters = raceCounters(state);
  const most = kthGreenAt(counters, MOST_GREENS);
  const activity = laneMix(state);
  return (
    <section className={styles.side} aria-label={side.label}>
      <header className={styles.sideHead}>
        <span className={styles.swatch} style={{ background: side.color }} aria-hidden="true" />
        <h2 className={styles.sideTitle}>{side.label}</h2>
        <span className={styles.sideSummary}>{side.summary}</span>
      </header>
      <div className={styles.stats}>
        <div className={styles.hero}>
          <span className={styles.heroValue}>{counters.green}</span>
          <span className={styles.heroLabel}>beans on the stalk, of {counters.beans}</span>
        </div>
        <dl className={styles.facts}>
          <div>
            <dt>{counters.wallSeconds === null ? 'Racing for' : 'Done in'}</dt>
            <dd>
              {formatMinutes(
                counters.wallSeconds ?? Math.max(0, now - (state.meta?.startedAt ?? now)),
              )}
            </dd>
          </div>
          <div>
            <dt>{MOST_GREENS}th green</dt>
            <dd>{most === null ? 'not yet' : formatMinutes(most)}</dd>
          </div>
          <div>
            <dt>Red validations</dt>
            <dd>{counters.redValidations}</dd>
          </div>
          <div>
            <dt>Agent spend</dt>
            <dd>{formatUsd(counters.costUsd)}</dd>
          </div>
        </dl>
      </div>
      <div
        className={styles.agents}
        aria-label={`Agents now: ${activity.busy} writing, ${activity.blocked} waiting, ${activity.idle} idle`}
      >
        <span className={styles.agentsLabel}>Agents now</span>
        <span className={styles.mix} aria-hidden="true">
          {state.lanes.map((lane) => (
            <span
              key={lane.slot}
              className={`${styles.agent} ${styles[lane.activity] ?? ''}`}
              title={`${lane.slot}: ${lane.activity}`}
            />
          ))}
        </span>
        <span className={styles.agentsText}>
          {activity.busy} writing, {activity.blocked} waiting, {activity.idle} idle
        </span>
      </div>
      <Vine run={side.run} state={state} titles={side.titles} />
    </section>
  );
}

function laneMix(state: RaceState): {
  readonly busy: number;
  readonly blocked: number;
  readonly idle: number;
} {
  const count = (activity: 'busy' | 'blocked' | 'idle') =>
    state.lanes.filter((lane) => lane.activity === activity).length;
  return { busy: count('busy'), blocked: count('blocked'), idle: count('idle') };
}

/** One sentence once both are done; until then, who leads. */
function Verdict(props: {
  readonly left: { readonly side: DuelSide; readonly state: RaceState };
  readonly right: { readonly side: DuelSide; readonly state: RaceState };
}) {
  const left = raceCounters(props.left.state);
  const right = raceCounters(props.right.state);
  return (
    <p className={styles.verdict} role="status">
      {verdictText(
        { label: props.left.side.label, counters: left },
        { label: props.right.side.label, counters: right },
      )}
    </p>
  );
}

type Racer = { readonly label: string; readonly counters: ReturnType<typeof raceCounters> };

function verdictText(left: Racer, right: Racer): string {
  const leftDone = left.counters.wallSeconds;
  const rightDone = right.counters.wallSeconds;
  if (leftDone !== null && rightDone !== null) {
    const [fast, slow] = leftDone <= rightDone ? [left, right] : [right, left];
    return `${mostSentence(fast, slow)}${fast.label} finished ${pace(fast.counters.wallSeconds, slow.counters.wallSeconds)} against ${formatMinutes(slow.counters.wallSeconds ?? 0)}, for ${formatUsd(fast.counters.costUsd)} against ${formatUsd(slow.counters.costUsd)} of agent spend.`;
  }
  if (leftDone !== null || rightDone !== null) {
    const done = leftDone !== null ? left : right;
    const racing = leftDone !== null ? right : left;
    return `${done.label} is done in ${formatMinutes(done.counters.wallSeconds ?? 0)}; ${racing.label} has ${racing.counters.green} beans on the stalk and is still racing.`;
  }
  const leftMost = kthGreenAt(left.counters, MOST_GREENS);
  const rightMost = kthGreenAt(right.counters, MOST_GREENS);
  if ((leftMost === null) !== (rightMost === null)) {
    const [first, other] = leftMost !== null ? [left, right] : [right, left];
    return `${first.label} has ${MOST_GREENS} beans on the stalk in ${formatMinutes(kthGreenAt(first.counters, MOST_GREENS) ?? 0)}; ${other.label} has ${other.counters.green}.`;
  }
  if (left.counters.green === right.counters.green)
    return `Level: ${left.counters.green} beans on the stalk each.`;
  const leader = left.counters.green > right.counters.green ? left : right;
  const gap = Math.abs(left.counters.green - right.counters.green);
  return `${leader.label} leads by ${gap} bean${gap === 1 ? '' : 's'} on the stalk.`;
}

/** "X got its 35th bean on the stalk 2.0× sooner (17.1 min against 35.0 min). " */
function mostSentence(fast: Racer, slow: Racer): string {
  const fastMost = kthGreenAt(fast.counters, MOST_GREENS);
  const slowMost = kthGreenAt(slow.counters, MOST_GREENS);
  if (fastMost === null || slowMost === null) return '';
  const [first, other] = fastMost <= slowMost ? [fast, slow] : [slow, fast];
  const [early, late] = fastMost <= slowMost ? [fastMost, slowMost] : [slowMost, fastMost];
  return `${first.label} got its ${MOST_GREENS}th bean on the stalk ${pace(early, late)} against ${other.label}'s ${formatMinutes(late)}. `;
}

/** `2.0× sooner, in 17.1 min` */
function pace(early: number | null, late: number | null): string {
  if (early === null || late === null || early <= 0) return '';
  return `${(late / early).toFixed(1)}× sooner, in ${formatMinutes(early)}`;
}
