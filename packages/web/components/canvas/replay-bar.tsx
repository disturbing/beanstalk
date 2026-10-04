'use client';

import { useEffect, useId } from 'react';

import type { RaceMoment } from '../../src/race/race-moments';
import { formatClock } from '../../src/race/race-format';
import styles from './canvas.module.css';
import type { ReplayClock, Speed } from './use-replay-clock';
import { SPEEDS } from './use-replay-clock';

/**
 * Play, speed and scrub a recorded race. Keyboard: Space plays or pauses, the arrows step
 * ten seconds (a minute with Shift), 1/2/3 pick 1x/10x/60x.
 */
export function ReplayBar(props: {
  readonly clock: ReplayClock;
  readonly moments: readonly RaceMoment[];
  readonly label: string;
  /** `sticky` follows the canvas down the page; `inline` stays where it is placed. */
  readonly placement?: 'sticky' | 'inline';
}) {
  const { clock } = props;
  const rangeId = useId();
  useShortcuts(clock);
  const placement = props.placement === 'inline' ? styles.barInline : '';
  return (
    <div
      className={`${styles.bar} ${placement}`}
      role="group"
      aria-label={`Replay controls for ${props.label}`}
    >
      <button
        type="button"
        className={styles.play}
        onClick={clock.toggle}
        aria-pressed={clock.playing}
      >
        <PlayGlyph playing={clock.playing} />
        {playLabel(clock)}
      </button>
      <fieldset className={styles.speeds}>
        <legend className="visually-hidden">Speed</legend>
        {SPEEDS.map((speed) => (
          <label key={speed} className={styles.speed}>
            <input
              type="radio"
              name={`${rangeId}-speed`}
              value={speed}
              checked={clock.speed === speed}
              onChange={() => clock.setSpeed(speed)}
            />
            <span>{speed}x</span>
          </label>
        ))}
      </fieldset>
      <div className={styles.scrub}>
        <label htmlFor={rangeId} className="visually-hidden">
          Race time
        </label>
        <input
          id={rangeId}
          type="range"
          className={styles.range}
          min={0}
          max={Math.ceil(clock.end)}
          step={1}
          value={Math.floor(clock.now)}
          aria-valuetext={`${formatClock(clock.now)} of ${formatClock(clock.end)}`}
          onChange={(event) => clock.seek(Number(event.currentTarget.value))}
        />
        <span className={styles.ticks} aria-hidden="true">
          {props.moments.map((moment) => (
            <span
              key={`${moment.t}-${moment.label}`}
              className={`${styles.tick} ${moment.label.includes('Decision') ? styles.tickHuman : styles.tickRed}`}
              style={{ left: `${(moment.t / Math.max(1, clock.end)) * 100}%` }}
              title={moment.label}
            />
          ))}
        </span>
      </div>
      <span className={styles.clock}>
        {formatClock(clock.now)} <span className={styles.clockEnd}>/ {formatClock(clock.end)}</span>
      </span>
    </div>
  );
}

function playLabel(clock: ReplayClock): string {
  if (clock.playing) return 'Pause';
  return clock.now >= clock.end ? 'Replay' : 'Play';
}

function useShortcuts(clock: ReplayClock): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.type !== 'range') return;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const step = event.shiftKey ? 60 : 10;
      if (event.key === ' ' && !(target instanceof HTMLButtonElement)) {
        event.preventDefault();
        clock.toggle();
      } else if (event.key === 'ArrowRight' && !(target instanceof HTMLInputElement)) {
        clock.seek(clock.now + step);
      } else if (event.key === 'ArrowLeft' && !(target instanceof HTMLInputElement)) {
        clock.seek(clock.now - step);
      } else if (event.key === '1' || event.key === '2' || event.key === '3') {
        const speed: Speed | undefined = SPEEDS[Number(event.key) - 1];
        if (speed !== undefined) clock.setSpeed(speed);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clock]);
}

function PlayGlyph({ playing }: { readonly playing: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      {playing ? (
        <path d="M2.5 1.5h2.5v9H2.5ZM7 1.5h2.5v9H7Z" fill="currentColor" />
      ) : (
        <path d="M2.5 1.2 10.5 6l-8 4.8Z" fill="currentColor" />
      )}
    </svg>
  );
}
