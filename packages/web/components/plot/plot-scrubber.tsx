'use client';

import { useId, useMemo } from 'react';

import type { RaceEvent } from '@beanstalk/shared-ask/race/race-events';
import { formatClock } from '../../src/race/race-format';
import type { LiveStatus } from '../canvas/use-live-events';
import type { ReplayClock } from '../canvas/use-replay-clock';
import { SPEEDS } from '../canvas/use-replay-clock';
import styles from './plot.module.css';

type Tick = { readonly t: number; readonly kind: 'land' | 'red' | 'decision' };

/** Play, speed and the playhead, with a tick for every landing, red validation and decision. */
export function PlotScrubber(props: {
  readonly clock: ReplayClock;
  readonly events: readonly RaceEvent[];
  readonly mode: 'replay' | 'live';
  readonly liveStatus: LiveStatus;
  readonly now: number;
}) {
  const { clock } = props;
  const rangeId = useId();
  const ticks = useMemo(() => ticksOf(props.events), [props.events]);
  if (props.mode === 'live') {
    return (
      <div className={styles.scrub}>
        <span className={styles.live}>
          {props.liveStatus === 'live' ? 'Live' : props.liveStatus}
        </span>
        <span />
        <span />
        <output className={styles.clock}>{formatClock(props.now)}</output>
        <span />
      </div>
    );
  }
  const end = Math.max(clock.end, 1);
  return (
    <div className={styles.scrub}>
      <button
        type="button"
        className={styles.play}
        onClick={clock.toggle}
        aria-label={clock.playing ? 'Pause' : 'Play the run'}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            d={clock.playing ? 'M4 2.5h3v11H4zM9 2.5h3v11H9z' : 'M4 2.5v11l9-5.5Z'}
            fill="currentColor"
          />
        </svg>
      </button>
      <div className={styles.speeds} role="group" aria-label="Speed">
        {SPEEDS.map((speed) => (
          <button
            key={speed}
            type="button"
            aria-pressed={clock.speed === speed}
            onClick={() => clock.setSpeed(speed)}
          >
            {speed}×
          </button>
        ))}
      </div>
      <div className={styles.track}>
        <div className={styles.ticks}>
          {ticks.map((tick, index) => (
            <i key={index} data-kind={tick.kind} style={{ left: `${(tick.t / end) * 100}%` }} />
          ))}
        </div>
        <label htmlFor={rangeId} className="visually-hidden">
          Moment of the run
        </label>
        <input
          id={rangeId}
          type="range"
          min={0}
          max={Math.round(end)}
          step={1}
          value={Math.round(clock.now)}
          onChange={(event) => clock.seek(Number(event.target.value))}
        />
      </div>
      <output className={styles.clock}>
        {formatClock(clock.now)} <small>of {formatClock(clock.end)}</small>
      </output>
      <button
        type="button"
        className={`${styles.speeds} ${styles.scrubEnd}`}
        onClick={() => clock.seek(clock.end)}
      >
        End
      </button>
    </div>
  );
}

function ticksOf(events: readonly RaceEvent[]): readonly Tick[] {
  return events.flatMap((event): readonly Tick[] => {
    if (event.type === 'land') return [{ t: event.t, kind: 'land' }];
    if (event.type === 'ci.end' && event.purpose === 'validate' && !event.green)
      return [{ t: event.t, kind: 'red' }];
    if (event.type === 'decision.request') return [{ t: event.t, kind: 'decision' }];
    return [];
  });
}
