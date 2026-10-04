'use client';

import { useId, useState } from 'react';

import type { RaceCounters } from '@beanstalk/shared-ask/race/race-counters';
import { kthGreenAt } from '@beanstalk/shared-ask/race/race-counters';
import { formatMinutes, formatUsd, ordinal, plural } from '../../src/race/race-format';
import styles from './canvas.module.css';

const MILESTONES = [10, 20, 30, 35] as const;

/** The header counters, as of the playhead (or now, live). */
export function Counters(props: {
  readonly counters: RaceCounters;
  readonly policy: 'queue' | 'beanstalk';
  readonly budgetUsd: number | null;
}) {
  const { counters } = props;
  const [k, setK] = useState<(typeof MILESTONES)[number]>(20);
  const selectId = useId();
  const kth = kthGreenAt(counters, k);
  return (
    <section className={styles.counters} aria-label="Race counters">
      <Tile
        label="On the stalk"
        value={`${counters.green}`}
        sub={`of ${counters.beans} beans`}
        tone="hero"
      />
      <Tile
        label={
          props.policy === 'queue' ? 'Landed (queue lands on the stalk)' : 'Landed on the sprout'
        }
        value={`${counters.landed}`}
        sub={`${counters.inFlight} in flight, ${counters.dropped} dropped`}
      />
      <div className={styles.tile}>
        <span className={styles.tileLabel}>
          <label htmlFor={selectId}>Time to the</label>
          <select
            id={selectId}
            className={styles.tileSelect}
            value={k}
            onChange={(event) => setK(milestone(event.currentTarget.value))}
          >
            {MILESTONES.map((value) => (
              <option key={value} value={value}>
                {ordinal(value)}
              </option>
            ))}
          </select>
          green
        </span>
        <span className={styles.tileValue}>{kth === null ? 'not yet' : formatMinutes(kth)}</span>
        <span className={styles.tileSub}>
          {kth === null ? `${counters.green} of ${k} so far` : 'run clock'}
        </span>
      </div>
      <Tile
        label="Agent spend"
        value={formatUsd(counters.costUsd)}
        sub={props.budgetUsd === null ? 'list prices' : `budget ${formatUsd(props.budgetUsd)}`}
      />
      <Tile
        label="Red validations"
        value={`${counters.redValidations}`}
        sub={props.policy === 'queue' ? 'red batches reset the queue' : 'each reverted or repaired'}
        tone={counters.redValidations > 0 ? 'red' : undefined}
      />
      <Tile
        label="Decision cards"
        value={`${counters.cards}`}
        sub={
          counters.openCards > 0
            ? `${plural(counters.openCards, 'card')} waiting for a person`
            : 'none waiting'
        }
        tone={counters.openCards > 0 ? 'human' : undefined}
      />
    </section>
  );
}

function milestone(value: string): (typeof MILESTONES)[number] {
  return MILESTONES.find((candidate) => String(candidate) === value) ?? 20;
}

function Tile(props: {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
  readonly tone?: 'hero' | 'red' | 'human' | undefined;
}) {
  const tone = { hero: styles.tileHero, red: styles.tileRed, human: styles.tileHuman };
  return (
    <div className={`${styles.tile} ${props.tone === undefined ? '' : (tone[props.tone] ?? '')}`}>
      <span className={styles.tileLabel}>{props.label}</span>
      <span className={styles.tileValue}>{props.value}</span>
      <span className={styles.tileSub}>{props.sub}</span>
    </div>
  );
}
