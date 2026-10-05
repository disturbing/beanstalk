'use client';

import Link from 'next/link';
import { useRef } from 'react';

import type { StalkRow } from '@beanstalk/shared-ask/home/stalk';
import { formatClock } from '../../src/race/race-format';
import styles from './home.module.css';

const PHASE_WORDS: Readonly<Record<string, string>> = {
  working: 'writing',
  checking: 'checking',
  rework: 'reworking',
  deciding: 'deciding',
  queued: 'queued',
  testing: 'in a batch',
};

/**
 * The stalk's rows: beans at the tip, leaves down the line, the root. Rows keep their keys,
 * so a leaf that appears during playback grows in and a leaf that changes state changes
 * colour in place. Leaves of the beans an answer is about stay bright; the rest dim.
 */
export function StalkList(props: {
  readonly rows: readonly StalkRow[];
  readonly owner: string;
  readonly relevant: ReadonlySet<string> | null;
  readonly selected: string | null;
  readonly hrefFor: (bean: string) => string;
}) {
  const firstKeys = useRef<ReadonlySet<string> | null>(null);
  firstKeys.current ??= new Set(props.rows.map((row) => row.key));
  const isNew = (key: string) => !(firstKeys.current?.has(key) ?? true);
  const hit = (task: string | null) =>
    task !== null && props.relevant?.has(task) ? '' : undefined;
  return (
    <>
      {props.rows.map((row) => {
        switch (row.kind) {
          case 'bean':
            return (
              <Link
                key={row.key}
                href={props.hrefFor(row.task)}
                className={styles.srow}
                data-bud=""
                data-phase={row.phase}
                data-hit={hit(row.task)}
                aria-current={props.selected === row.task ? 'true' : undefined}
                title={row.title}
              >
                <span className={styles.ag}>{row.slot ?? ''}</span>
                <span className={styles.stem}>
                  <i className={styles.bud} />
                </span>
                <span className={styles.tt}>
                  {row.title} <small>{PHASE_WORDS[row.phase] ?? row.phase}</small>
                </span>
                <span />
              </Link>
            );
          case 'idle':
            return (
              <div key={row.key} className={styles.note}>
                <span />
                <span className={styles.stem} />
                <span>
                  {row.finished
                    ? 'Nothing growing. The run is finished.'
                    : 'Nothing growing right now.'}
                </span>
              </div>
            );
          case 'leaf':
            return (
              <Link
                key={row.key}
                href={row.task === null ? '#' : props.hrefFor(row.task)}
                className={`${styles.srow} ${isNew(row.key) ? styles.enter : ''}`}
                data-leaf={row.status}
                data-side={row.idx % 2 === 1 ? 'l' : 'r'}
                data-hit={hit(row.task)}
                aria-current={row.task !== null && props.selected === row.task ? 'true' : undefined}
                title={row.title}
              >
                <span className={styles.tm}>{formatClock(row.t)}</span>
                <span className={styles.stem}>
                  <i className={styles.leaf} />
                </span>
                <span className={styles.tt}>{row.title}</span>
                <span className={styles.ix}>#{row.idx}</span>
              </Link>
            );
          case 'fell':
            return (
              <Link
                key={row.key}
                href={props.hrefFor(row.task)}
                className={`${styles.srow} ${styles.fell}`}
                data-hit={hit(row.task)}
                aria-current={props.selected === row.task ? 'true' : undefined}
                title={`Fell off: ${row.reason}`}
              >
                <span className={styles.tm}>{formatClock(row.t)}</span>
                <span className={styles.stem}>
                  <i className={styles.fallen} />
                </span>
                <span className={styles.tt}>{row.title}</span>
                <span className={styles.ix}>fell</span>
              </Link>
            );
          case 'pointer':
            return (
              <div key={row.key} className={styles.pointer}>
                <span />
                <span className={styles.stem} />
                <span>
                  stalk at #{row.stalkIdx}, {row.ahead} on the sprout above
                </span>
              </div>
            );
          case 'fold':
            return (
              <div key={row.key} className={styles.pointer}>
                <span />
                <span className={styles.stem} />
                <span>
                  validated at {formatClock(row.t)}: {row.count} beans
                </span>
              </div>
            );
          default:
            return assertNever(row);
        }
      })}
      <div className={styles.root}>
        <span />
        <span className={styles.stem} />
        <span>Fertilized by {props.owner}</span>
      </div>
    </>
  );
}

function assertNever(value: never): never {
  throw new Error(`unexpected row ${JSON.stringify(value)}`);
}
